import networkx as nx

from app.graph.import_resolver import RepositoryFileIndex
from app.graph.models import DependencyGraphMetrics, DependencyGraphResult, GraphEdge, GraphEdgeType, GraphNode, GraphNodeType
from app.schemas.source import Inheritance, SourceFile

# Enumerating every simple cycle is exponential: a single 17-file strongly connected component can
# contain millions of cycles, which would hang the analysis. Reporting is therefore bounded to the
# shortest cycles of each component, and the graph records that the list was truncated.
MAX_REPORTED_CYCLES = 150
MAX_CYCLES_PER_COMPONENT = 25
MAX_CYCLE_LENGTH = 12
# Components larger than this are reported as strongly connected components only; enumerating their
# cycles is not affordable and their mutual dependence is already fully described by the SCC.
MAX_COMPONENT_SIZE_FOR_CYCLE_SEARCH = 200
# Exact betweenness is O(V·E) and dominates runtime on huge repositories. Above this
# internal-node count the metric falls back to a sampled estimate (NetworkX `k`-sampled
# Brandes) so graph construction stays bounded; importance ranking blends degree and
# centrality, so estimates are sufficient for ranking purposes.
EXACT_CENTRALITY_NODE_LIMIT = 5_000


class DependencyGraphBuilder:
    def build(self, source_files: list[SourceFile]) -> DependencyGraphResult:
        index = RepositoryFileIndex(source_files)
        graph = nx.MultiDiGraph()
        nodes: dict[str, GraphNode] = {}
        edges: list[GraphEdge] = []
        for item in source_files:
            node = GraphNode(id=item.path, node_type=GraphNodeType.FILE, path_name=item.path, language=item.language.value if item.language else None)
            nodes[item.path] = node
            graph.add_node(item.path, node_type=GraphNodeType.FILE.value)

        for source in source_files:
            if source.parse_status.value != "success":
                continue
            for import_item in source.imports:
                resolution = index.resolve(source, import_item)
                target_id, target_type, target_file = self._target_for_resolution(resolution, import_item.module)
                if target_id not in nodes:
                    nodes[target_id] = GraphNode(
                        id=target_id,
                        node_type=target_type,
                        path_name=import_item.module,
                        language=None,
                        metadata={"classification": resolution.classification, "candidates": list(resolution.candidates), "reason": resolution.reason},
                    )
                    graph.add_node(target_id, node_type=target_type.value)
                edge = GraphEdge(
                    source=source.path,
                    target=target_id,
                    edge_type=GraphEdgeType.IMPORTS,
                    resolved=resolution.classification == "internal",
                    import_evidence={
                        "module": import_item.module,
                        "kind": import_item.kind,
                        "imported_names": import_item.imported_names,
                        "alias": import_item.alias,
                        "line_start": import_item.line_start,
                        "line_end": import_item.line_end,
                        "classification": resolution.classification,
                        "candidates": list(resolution.candidates),
                        "reason": resolution.reason,
                    },
                    source_file=source.path,
                    target_file=target_file,
                )
                edges.append(edge)
                graph.add_edge(source.path, target_id, edge_type=GraphEdgeType.IMPORTS.value, resolved=edge.resolved, evidence=edge.import_evidence)

            for inheritance in source.inheritance:
                target = self._resolve_inheritance(source, inheritance, index)
                if target is None:
                    target_id = f"unresolved:{inheritance.parent}"
                    target_type = GraphNodeType.UNRESOLVED
                    resolved = False
                    target_file = None
                else:
                    target_id = target
                    target_type = GraphNodeType.FILE
                    resolved = True
                    target_file = target
                if target_id not in nodes:
                    nodes[target_id] = GraphNode(id=target_id, node_type=target_type, path_name=inheritance.parent, metadata={"reason": "Inheritance target not found in repository"} if not resolved else {})
                    graph.add_node(target_id, node_type=target_type.value)
                edge_type = GraphEdgeType.EXTENDS if inheritance.relation == "extends" or inheritance.relation == "inherits" else GraphEdgeType.IMPLEMENTS
                evidence = {
                    "child": inheritance.child,
                    "parent": inheritance.parent,
                    "relation": inheritance.relation,
                    "line_start": inheritance.line_start,
                    "line_end": inheritance.line_end,
                    "classification": "internal" if resolved else "unresolved",
                }
                edges.append(GraphEdge(source=source.path, target=target_id, edge_type=edge_type, resolved=resolved, import_evidence=evidence, source_file=source.path, target_file=target_file))
                graph.add_edge(source.path, target_id, edge_type=edge_type.value, resolved=resolved, evidence=evidence)

        metrics, cycles, cycles_truncated, sccs, ranking = self._calculate_metrics(graph, nodes)
        return DependencyGraphResult(
            nodes=list(nodes.values()),
            edges=edges,
            metrics=metrics,
            cycles=cycles,
            cycles_truncated=cycles_truncated,
            strongly_connected_components=sccs,
            importance_ranking=ranking,
        )

    @staticmethod
    def _target_for_resolution(resolution, module: str):
        if resolution.classification == "internal" and resolution.target:
            return resolution.target, GraphNodeType.FILE, resolution.target
        if resolution.classification == "external":
            return resolution.target or f"external:{module}", GraphNodeType.EXTERNAL, None
        label = resolution.classification
        return f"unresolved:{label}:{module}", GraphNodeType.UNRESOLVED, None

    @staticmethod
    def _resolve_inheritance(source: SourceFile, inheritance: Inheritance, index: RepositoryFileIndex) -> str | None:
        # Index-backed lookup: O(1) per edge instead of a full symbol rescan.
        matches = sorted(set(index.symbol_declarations.get(inheritance.parent, [])))
        if len(matches) == 1:
            return matches[0]
        return None

    @staticmethod
    def _calculate_metrics(graph: nx.MultiDiGraph, nodes: dict[str, GraphNode]):
        internal = nx.DiGraph()
        internal.add_nodes_from(path for path, node in nodes.items() if node.node_type == GraphNodeType.FILE)
        for source, target, data in graph.edges(data=True):
            if data.get("edge_type") == GraphEdgeType.IMPORTS.value and data.get("resolved") and nodes[source].node_type == GraphNodeType.FILE and nodes[target].node_type == GraphNodeType.FILE:
                internal.add_edge(source, target)

        internal_count = internal.number_of_nodes()
        if internal_count == 0:
            centrality = {}
        elif internal_count <= EXACT_CENTRALITY_NODE_LIMIT:
            centrality = nx.betweenness_centrality(internal, normalized=True)
        else:
            # Sampled Brandes: estimates for every node, bounded runtime, deterministic
            # via the fixed seed. Sufficient for importance ranking.
            centrality = nx.betweenness_centrality(internal, normalized=True, k=EXACT_CENTRALITY_NODE_LIMIT, seed=0)
        indegree = dict(internal.in_degree())
        outdegree = dict(internal.out_degree())
        raw_importance = {
            node: float(indegree.get(node, 0) + outdegree.get(node, 0)) + centrality.get(node, 0.0)
            for node in internal.nodes
        }
        ranking = sorted(raw_importance, key=lambda n: (-raw_importance[n], n))
        rank_positions = {node: idx + 1 for idx, node in enumerate(ranking)}
        node_metrics = {}
        for node in internal.nodes:
            node_metrics[node] = {
                "incoming_dependencies": indegree.get(node, 0),
                "outgoing_dependencies": outdegree.get(node, 0),
                "degree": indegree.get(node, 0) + outdegree.get(node, 0),
                "betweenness_centrality": centrality.get(node, 0.0),
                "importance": raw_importance.get(node, 0.0),
                "rank": rank_positions[node],
            }

        sccs = [sorted(component) for component in nx.strongly_connected_components(internal) if len(component) > 1]
        sccs.sort(key=lambda component: (component[0], len(component)))
        cycles, truncated = DependencyGraphBuilder._collect_cycles(internal, sccs)
        return DependencyGraphMetrics(node_metrics=node_metrics), cycles, truncated, sccs, ranking

    @staticmethod
    def _collect_cycles(internal: nx.DiGraph, sccs: list[list[str]]):
        """Collect the shortest cycles of each strongly connected component.

        The search widens the length bound from 2 upwards so the shortest cycles are found first,
        and stops as soon as a component or the repository-wide budget is exhausted. Self-loops are
        ignored: NetworkX reports them as one-element cycles, but a file importing itself is a
        self-edge rather than a cycle between files.
        """
        # Largest components first: they carry the most interesting cycles.
        ordered = sorted(sccs, key=lambda component: (-len(component), component[0]))
        cycles: list[dict[str, object]] = []
        seen: set[tuple[str, ...]] = set()
        truncated = False
        for component in ordered:
            if len(component) > MAX_COMPONENT_SIZE_FOR_CYCLE_SEARCH:
                truncated = True
                continue
            subgraph = internal.subgraph(component)
            found = 0
            exhausted = False
            for length_bound in range(2, MAX_CYCLE_LENGTH + 1):
                for cycle in nx.simple_cycles(subgraph, length_bound=length_bound):
                    members = tuple(sorted(set(cycle)))
                    if len(members) < 2 or members in seen:
                        continue
                    seen.add(members)
                    cycles.append({"files": sorted(cycle), "length": len(cycle)})
                    found += 1
                    if found >= MAX_CYCLES_PER_COMPONENT or len(cycles) >= MAX_REPORTED_CYCLES:
                        truncated = True
                        exhausted = True
                        break
                if exhausted:
                    break
            if len(cycles) >= MAX_REPORTED_CYCLES and len(ordered) > 1:
                truncated = True
                break
        cycles.sort(key=lambda item: (item["length"], item["files"]))
        return cycles, truncated
