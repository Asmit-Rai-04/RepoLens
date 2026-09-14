import type { DependencyGraphResult, GraphEdge, GraphNode, GraphNodeType, NodeMetrics } from "../api/graph-types";
import type { Edge, Node } from "@xyflow/react";

export type GraphFilter = "ALL" | "CYCLES" | "UNRESOLVED" | "EXTERNAL" | "IMPORTANT";

export interface GraphViewData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metrics: Record<string, NodeMetrics>;
  truncated: boolean;
  totalNodeCount: number;
}

/** Data carried by a renderable dependency node. */
export interface DependencyNodeData extends Record<string, unknown> {
  node: GraphNode;
  metrics: NodeMetrics | null;
  cycle: boolean;
  focused: boolean;
}

export type DependencyNode = Node<DependencyNodeData, "dependency">;

/** Data carried by a renderable dependency edge; the backend edge is preserved verbatim. */
export interface DependencyEdgeData extends Record<string, unknown> {
  edge: GraphEdge;
}

export type DependencyEdge = Edge<DependencyEdgeData>;

export function nodeClass(node: GraphNode): GraphNodeType {
  return node.node_type;
}

export function importanceSet(graph: DependencyGraphResult): Set<string> {
  const limit = Math.min(graph.importance_ranking.length, Math.max(5, Math.ceil(graph.nodes.length * 0.2)));
  return new Set(graph.importance_ranking.slice(0, limit));
}

function cycleMembers(graph: DependencyGraphResult): Set<string> {
  return new Set(graph.cycles.flatMap((cycle) => cycle.files));
}

export function applyFilter(graph: DependencyGraphResult, filter: GraphFilter): DependencyGraphResult {
  if (filter === "ALL") return graph;
  const cycleNodes = cycleMembers(graph);
  const important = importanceSet(graph);
  const keep = new Set(
    graph.nodes
      .filter((node) =>
        filter === "CYCLES" ? cycleNodes.has(node.id) :
        filter === "UNRESOLVED" ? node.node_type === "unresolved" :
        filter === "EXTERNAL" ? node.node_type === "external" :
        important.has(node.id)
      )
      .map((node) => node.id),
  );
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
    metrics: { node_metrics: Object.fromEntries([...keep].flatMap((id) => graph.metrics.node_metrics[id] ? [[id, graph.metrics.node_metrics[id]]] : [])) },
  };
}

export function searchNodes(graph: DependencyGraphResult, query: string): Set<string> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return new Set(graph.nodes.map((node) => node.id));
  return new Set(graph.nodes.filter((node) => node.path_name.toLowerCase().includes(normalized) || node.id.toLowerCase().includes(normalized)).map((node) => node.id));
}

export function focusMembers(graph: DependencyGraphResult, members: string[]): DependencyGraphResult {
  const keep = new Set(members);
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
    metrics: { node_metrics: Object.fromEntries(members.flatMap((id) => graph.metrics.node_metrics[id] ? [[id, graph.metrics.node_metrics[id]]] : [])) },
  };
}

/**
 * Reduces a graph to a renderable size using the backend importance ranking.
 *
 * Selection is deterministic: highest-ranked nodes first, then their connected neighbours while
 * space remains. `preferred` (used for deep links) is always retained so a linked file is
 * guaranteed to be visible.
 */
export function capGraph(graph: DependencyGraphResult, limit: number, preferred: string[] = []): GraphViewData {
  const ids = graph.nodes.map((node) => node.id);
  const existing = new Set(ids);
  const pinned = preferred.filter((id) => existing.has(id));
  if (graph.nodes.length <= limit) {
    return { nodes: graph.nodes, edges: graph.edges, metrics: graph.metrics.node_metrics, truncated: false, totalNodeCount: graph.nodes.length };
  }

  // The backend importance ranking only covers internal files, so external and unresolved
  // nodes fall back to their degree inside the current view and then to their id. Ranking
  // every node guarantees a filter such as EXTERNAL cannot render an empty canvas.
  const rankIndex = new Map(graph.importance_ranking.map((id, index) => [id, index]));
  const degree = new Map<string, number>();
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  const ordered = [...ids].sort((a, b) => {
    const rankA = rankIndex.get(a) ?? Number.POSITIVE_INFINITY;
    const rankB = rankIndex.get(b) ?? Number.POSITIVE_INFINITY;
    if (rankA !== rankB) return rankA - rankB;
    const degreeA = degree.get(a) ?? 0;
    const degreeB = degree.get(b) ?? 0;
    if (degreeA !== degreeB) return degreeB - degreeA;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const keep = new Set(pinned.slice(0, limit));
  for (const id of ordered) {
    if (keep.size >= limit) break;
    keep.add(id);
  }
  for (const edge of graph.edges) {
    if (keep.size >= limit) break;
    const sourceSelected = keep.has(edge.source);
    const targetSelected = keep.has(edge.target);
    if (sourceSelected !== targetSelected) keep.add(sourceSelected ? edge.target : edge.source);
  }
  const nodes = graph.nodes.filter((node) => keep.has(node.id));
  const edges = graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target));
  return { nodes, edges, metrics: graph.metrics.node_metrics, truncated: nodes.length < graph.nodes.length, totalNodeCount: graph.nodes.length };
}

export function transformNodes(graph: DependencyGraphResult, cycleIds = new Set<string>(), focusedIds: Set<string> | null = null): DependencyNode[] {
  return graph.nodes.map((node) => ({
    id: node.id,
    type: "dependency" as const,
    position: { x: 0, y: 0 },
    data: {
      node,
      cycle: cycleIds.has(node.id),
      focused: focusedIds ? focusedIds.has(node.id) : true,
      metrics: graph.metrics.node_metrics[node.id] ?? null,
    },
  }));
}

export function transformEdges(graph: DependencyGraphResult, cycleIds = new Set<string>(), focusedIds: Set<string> | null = null): DependencyEdge[] {
  return graph.edges.map((edge, index) => {
    const inFocus = !focusedIds || (focusedIds.has(edge.source) && focusedIds.has(edge.target));
    const cycleEdge = cycleIds.has(edge.source) && cycleIds.has(edge.target);
    return {
      id: `dependency-${index}-${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      label: edge.edge_type,
      className: ["dependency-edge", `edge-${edge.edge_type.toLowerCase()}`, !edge.resolved ? "edge-unresolved" : "", cycleEdge ? "edge-cycle" : "", inFocus ? "" : "edge-dim"].filter(Boolean).join(" "),
      data: { edge },
      animated: cycleEdge,
    };
  });
}
