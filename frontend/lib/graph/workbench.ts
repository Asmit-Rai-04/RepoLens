import type {
  DependencyGraphResult,
  GraphEdge,
  GraphNode,
} from "../api/graph-types";
import { applyFilter, type GraphFilter } from "./dependency-graph";

export type EntityKind = "node" | "module" | "cycle";
export type Direction = "dependencies" | "dependents" | "both";
export type LayoutMode = "hierarchical" | "compact";
export interface Module {
  id: string;
  label: string;
  members: string[];
}
export interface GraphIndex {
  nodes: Map<string, GraphNode>;
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
  modules: Module[];
  moduleById: Map<string, Module>;
  moduleByNode: Map<string, string>;
  search: { id: string; label: string; category: string; text: string }[];
}

/** Directory grouping is a navigation aid, not an inferred architecture boundary. */
export function moduleKey(node: GraphNode): string {
  if (node.node_type !== "file") return `module:type:${node.node_type}`;
  const parts = node.path_name.split("/");
  return parts.length > 1
    ? `module:dir:${parts.slice(0, Math.min(2, parts.length - 1)).join("/")}`
    : "module:root";
}

export function indexGraph(graph: DependencyGraphResult): GraphIndex {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();
  const groups = new Map<string, Module>();
  const moduleByNode = new Map<string, string>();
  for (const node of graph.nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, []);
    const id = moduleKey(node);
    if (!groups.has(id))
      groups.set(id, {
        id,
        label:
          id === "module:root"
            ? "(root)"
            : id.startsWith("module:dir:")
              ? id.slice(11)
              : node.node_type,
        members: [],
      });
    groups.get(id)!.members.push(node.id);
    moduleByNode.set(node.id, id);
  }
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    outgoing.get(edge.source)!.push(edge);
    incoming.get(edge.target)!.push(edge);
  }
  const modules = [...groups.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const module of modules) module.members.sort();
  const important = new Set(
    graph.importance_ranking.slice(
      0,
      Math.max(5, Math.ceil(graph.nodes.length * 0.2)),
    ),
  );
  const search = [
    ...graph.nodes.map((node) => ({
      id: node.id,
      label: node.path_name,
      category:
        node.node_type === "file"
          ? important.has(node.id)
            ? "Important file"
            : "File"
          : node.node_type === "external"
            ? "External"
            : "Unresolved",
      text: `${node.id} ${node.path_name} ${node.language ?? ""} ${important.has(node.id) ? "important" : ""}`.toLowerCase(),
    })),
    ...modules.map((module) => ({
      id: module.id,
      label: module.label,
      category: "Module",
      text: module.label.toLowerCase(),
    })),
    ...graph.cycles.map((cycle, i) => ({
      id: `cycle:${i}`,
      label: `Cycle ${i + 1}: ${cycle.files.join(" → ")}`,
      category: "Cycle",
      text: `cycle ${i + 1} ${cycle.files.join(" ")}`.toLowerCase(),
    })),
  ];
  return {
    nodes,
    outgoing,
    incoming,
    modules,
    moduleById: groups,
    moduleByNode,
    search,
  };
}

export interface Visit {
  depth: number;
  parent: string | null;
}
/** Edges point from importer to imported file. Reverse BFS gives potential structural impact. */
export function traverse(
  index: GraphIndex,
  start: string,
  direction: Direction,
  depth = Infinity,
): Map<string, Visit> {
  const visits = new Map<string, Visit>();
  if (!index.nodes.has(start)) return visits;
  visits.set(start, { depth: 0, parent: null });
  const queue = [start];
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    const distance = visits.get(id)!.depth;
    if (distance >= depth) continue;
    const next = [
      ...(direction !== "dependents"
        ? (index.outgoing.get(id) ?? []).map((edge) => edge.target)
        : []),
      ...(direction !== "dependencies"
        ? (index.incoming.get(id) ?? []).map((edge) => edge.source)
        : []),
    ];
    for (const target of next)
      if (!visits.has(target)) {
        visits.set(target, { depth: distance + 1, parent: id });
        queue.push(target);
      }
  }
  return visits;
}

export function dependencyPath(
  visits: Map<string, Visit>,
  id: string,
): string[] {
  const path: string[] = [];
  let current: string | null = id;
  while (current !== null && visits.has(current)) {
    path.push(current);
    current = visits.get(current)!.parent;
  }
  return path;
}

export function subsetGraph(
  graph: DependencyGraphResult,
  ids: Set<string>,
): DependencyGraphResult {
  return {
    ...graph,
    nodes: graph.nodes.filter((node) => ids.has(node.id)),
    edges: graph.edges.filter(
      (edge) => ids.has(edge.source) && ids.has(edge.target),
    ),
  };
}

/** Preserve importers for external/unresolved filters so their relationships remain visible. */
export function filterGraph(
  graph: DependencyGraphResult,
  index: GraphIndex,
  filter: GraphFilter,
): DependencyGraphResult {
  if (filter !== "EXTERNAL" && filter !== "UNRESOLVED")
    return applyFilter(graph, filter);
  const ids = new Set(
    graph.nodes
      .filter(
        (node) =>
          node.node_type ===
          (filter === "EXTERNAL" ? "external" : "unresolved"),
      )
      .map((node) => node.id),
  );
  for (const id of [...ids])
    for (const edge of index.incoming.get(id) ?? []) ids.add(edge.source);
  return subsetGraph(graph, ids);
}

export function aggregateModules(
  graph: DependencyGraphResult,
  index: GraphIndex,
): DependencyGraphResult {
  const present = new Set(graph.nodes.map((node) => node.id));
  const nodes: GraphNode[] = index.modules.flatMap((module) => {
    const members = module.members.filter((id) => present.has(id));
    return members.length
      ? [
          {
            id: module.id,
            path_name: module.label,
            node_type: index.nodes.get(members[0])?.node_type ?? "file",
            language: null,
            metadata: {
              members,
              classification: `${members.length} entities · ${module.id.startsWith("module:type:") ? "dependency group" : "directory group"}`,
            },
          },
        ]
      : [];
  });
  const edges = new Map<string, GraphEdge>();
  for (const edge of graph.edges) {
    const source = index.moduleByNode.get(edge.source),
      target = index.moduleByNode.get(edge.target);
    if (!source || !target || source === target) continue;
    const key = JSON.stringify([source, target, edge.edge_type]);
    const previous = edges.get(key);
    edges.set(key, {
      ...edge,
      source,
      target,
      import_evidence: {
        count: (Number(previous?.import_evidence.count) || 0) + 1,
      },
    });
  }
  return {
    ...graph,
    nodes,
    edges: [...edges.values()],
    metrics: { node_metrics: {} },
    cycles: [],
    importance_ranking: [],
  };
}

export function searchIndex(index: GraphIndex, query: string) {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return index.search.filter((entry) =>
    terms.every((term) => entry.text.includes(term)),
  );
}

export interface WorkspaceState {
  file: string | null;
  module: string | null;
  level: "modules" | "files";
  filter: GraphFilter;
  mode: "normal" | "focus" | "impact";
  direction: Direction;
  depth: number;
  cycle: number | null;
  layout: LayoutMode;
}
export const defaultState: WorkspaceState = {
  file: null,
  module: null,
  level: "modules",
  filter: "ALL",
  mode: "normal",
  direction: "both",
  depth: 1,
  cycle: null,
  layout: "hierarchical",
};
export function readWorkspaceState(
  params: URLSearchParams,
  graph: DependencyGraphResult,
): WorkspaceState {
  const file = params.get("file");
  const legacy = params.get("cycle");
  const compactCycle = params.get("cycleIndex");
  const cycle =
    compactCycle &&
    /^\d+$/.test(compactCycle) &&
    graph.cycles[Number(compactCycle)]
      ? Number(compactCycle)
      : legacy
        ? graph.cycles.findIndex((item) => item.files.join(",") === legacy)
        : -1;
  const filter = params.get("filter");
  const mode = params.get("focus");
  const direction = params.get("direction");
  return {
    ...defaultState,
    file: graph.nodes.some((node) => node.id === file)
      ? file
      : cycle >= 0
        ? graph.cycles[cycle].files[0]
        : null,
    module: params.get("module"),
    level:
      file || legacy || cycle >= 0 || params.get("level") === "files"
        ? "files"
        : "modules",
    filter: ["ALL", "CYCLES", "UNRESOLVED", "EXTERNAL", "IMPORTANT"].includes(
      filter ?? "",
    )
      ? (filter as GraphFilter)
      : "ALL",
    mode: mode === "focus" || mode === "impact" ? mode : "normal",
    direction:
      mode === "impact"
        ? "dependents"
        : direction === "dependencies" || direction === "dependents"
          ? direction
          : "both",
    depth:
      params.get("depth") === "all"
        ? Infinity
        : params.get("depth") === "2"
          ? 2
          : 1,
    cycle: cycle >= 0 ? cycle : null,
    layout: params.get("layout") === "compact" ? "compact" : "hierarchical",
  };
}
export function workspaceParams(
  state: WorkspaceState,
  graph: DependencyGraphResult,
): URLSearchParams {
  const params = new URLSearchParams();
  if (state.file) params.set("file", state.file);
  if (state.module) params.set("module", state.module);
  if (state.level === "files") params.set("level", "files");
  if (state.filter !== "ALL") params.set("filter", state.filter);
  if (state.mode !== "normal") params.set("focus", state.mode);
  if (state.direction !== "both") params.set("direction", state.direction);
  if (state.depth !== 1)
    params.set("depth", state.depth === Infinity ? "all" : String(state.depth));
  if (state.cycle !== null && graph.cycles[state.cycle])
    params.set("cycleIndex", String(state.cycle));
  if (state.layout !== "hierarchical") params.set("layout", state.layout);
  return params;
}
