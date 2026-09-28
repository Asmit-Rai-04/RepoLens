import type { DependencyGraphResult, GraphEdge, GraphNode } from "../api/graph-types";

/**
 * Deterministic, topology-aware layout helpers for the dependency graph.
 *
 * Everything here is a pure presentation transform: backend graph data is never mutated,
 * no dependencies are invented or removed, and the same input always produces the same
 * output (no randomness, no unstable iteration order).
 */

/* ------------------------------------------------------------------ */
/* Layer ranking (SCC condensation + longest-path layering)            */
/* ------------------------------------------------------------------ */

export interface LayeredGraph {
  /** node id -> layer index (0 = sources/entry, higher = further downstream) */
  layers: Map<string, number>;
  /** SCC key -> member node ids (only multi-member SCCs) */
  sccGroups: Map<string, string[]>;
  /** node id -> SCC key (only nodes inside a multi-member SCC) */
  sccOf: Map<string, string>;
}

/**
 * Tarjan-free SCC via iterative Kosaraju: O(V+E), deterministic order.
 * Returns SCCs as arrays of node ids (singletons included).
 */
export function computeSCCs(nodes: string[], adjacency: Map<string, string[]>): string[][] {
  const order: string[] = [];
  const visited = new Set<string>();
  const nodeSet = new Set(nodes);

  const visit = (start: string) => {
    const stack: Array<{ id: string; index: number }> = [{ id: start, index: 0 }];
    const path: string[] = [];
    const onPath = new Set<string>();
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame.index === 0) {
        visited.add(frame.id);
        path.push(frame.id);
        onPath.add(frame.id);
      }
      const neighbors = adjacency.get(frame.id) ?? [];
      if (frame.index < neighbors.length) {
        const next = neighbors[frame.index];
        frame.index += 1;
        if (nodeSet.has(next) && !visited.has(next)) {
          stack.push({ id: next, index: 0 });
        } else if (onPath.has(next)) {
          // cycle detected on the current path — nothing to record here, SCC pass handles it
        }
      } else {
        stack.pop();
        const popped = path.pop();
        if (popped !== undefined) {
          onPath.delete(popped);
          order.push(popped);
        }
      }
    }
  };

  for (const node of nodes) if (!visited.has(node)) visit(node);

  const reverse = new Map<string, string[]>();
  for (const id of nodes) reverse.set(id, []);
  for (const [source, targets] of adjacency) {
    for (const target of targets) {
      if (nodeSet.has(target)) reverse.get(target)!.push(source);
    }
  }

  const assigned = new Set<string>();
  const components: string[][] = [];
  // Order of finish times (reverse postorder) guarantees correct SCC discovery.
  for (let i = order.length - 1; i >= 0; i -= 1) {
    const start = order[i];
    if (assigned.has(start)) continue;
    const component: string[] = [];
    const queue = [start];
    assigned.add(start);
    while (queue.length > 0) {
      const current = queue.pop()!;
      component.push(current);
      for (const source of reverse.get(current) ?? []) {
        if (!assigned.has(source)) {
          assigned.add(source);
          queue.push(source);
        }
      }
    }
    component.sort();
    components.push(component);
  }
  return components;
}

/**
 * Longest-path layering over any DAG-shaped edge list (cycles must already be collapsed).
 * Shared by the file-level and module-level layouts; O(V+E), deterministic via id tiebreaks.
 */
export function layerDAG(ids: string[], edges: Array<{ source: string; target: string }>): Map<string, number> {
  const idSet = new Set(ids);
  const adjacency = new Map<string, Set<string>>();
  for (const id of ids) adjacency.set(id, new Set());
  const indegree = new Map<string, number>();
  for (const id of ids) indegree.set(id, 0);
  for (const edge of edges) {
    if (!idSet.has(edge.source) || !idSet.has(edge.target)) continue;
    const targets = adjacency.get(edge.source)!;
    if (edge.source === edge.target || targets.has(edge.target)) continue;
    targets.add(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const layer = new Map<string, number>();
  const queue = ids.filter((id) => (indegree.get(id) ?? 0) === 0);
  for (const id of queue) layer.set(id, 0);
  let head = 0;
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    const nextLayer = (layer.get(current) ?? 0) + 1;
    for (const target of adjacency.get(current) ?? []) {
      layer.set(target, Math.max(layer.get(target) ?? 0, nextLayer));
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if ((indegree.get(target) ?? 0) === 0) queue.push(target);
    }
  }
  // Nodes unreachable from a source (defensive; e.g. empty edge list) get layer 0.
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);
  return layer;
}

/**
 * Assigns each node a layer so edges generally flow left-to-right (or top-to-bottom).
 *
 * Cycles are collapsed first (each multi-member SCC becomes one super-node), then the
 * condensation graph — which is a DAG — is layered with the longest-path method. This gives
 * entry points small layer numbers and leaf/util modules large ones, which is exactly the
 * "dependency flows downhill" reading the graph page wants.
 */
export function computeLayers(graph: DependencyGraphResult): LayeredGraph {
  const ids = graph.nodes.map((node) => node.id);
  const idSet = new Set(ids);
  const adjacency = new Map<string, string[]>();
  for (const id of ids) adjacency.set(id, []);
  for (const edge of graph.edges) {
    if (idSet.has(edge.source) && idSet.has(edge.target)) adjacency.get(edge.source)!.push(edge.target);
  }
  for (const list of adjacency.values()) list.sort(); // determinism

  const components = computeSCCs(ids, adjacency);
  const sccOf = new Map<string, string>();
  const sccGroups = new Map<string, string[]>();
  for (const component of components) {
    if (component.length < 2) continue;
    const key = `scc:${component.join("|")}`;
    sccGroups.set(key, component);
    for (const member of component) sccOf.set(member, key);
  }

  // Condensation: super-nodes are SCC groups, everything else is itself.
  const superOf = (id: string) => sccOf.get(id) ?? id;
  const superIds = new Set<string>([...sccGroups.keys(), ...ids.filter((id) => !sccOf.has(id))]);
  const superAdjacency = new Map<string, Set<string>>();
  for (const id of superIds) superAdjacency.set(id, new Set());
  for (const edge of graph.edges) {
    const source = superOf(edge.source);
    const target = superOf(edge.target);
    if (source === target || !superAdjacency.has(source) || !superAdjacency.has(target)) continue;
    superAdjacency.get(source)!.add(target);
  }

  // Longest-path layering over the DAG (iterative, O(V+E)); ties broken by id for determinism.
  const indegree = new Map<string, number>();
  for (const id of superIds) indegree.set(id, 0);
  for (const targets of superAdjacency.values()) for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);

  const layer = new Map<string, number>();
  const queue: string[] = [...superIds].filter((id) => (indegree.get(id) ?? 0) === 0).sort();
  for (const id of queue) layer.set(id, 0);
  let head = 0;
  const order: string[] = [];
  while (head < queue.length) {
    const current = queue[head];
    head += 1;
    order.push(current);
    const nextLayer = (layer.get(current) ?? 0) + 1;
    for (const target of [...(superAdjacency.get(current) ?? [])].sort()) {
      layer.set(target, Math.max(layer.get(target) ?? 0, nextLayer));
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if ((indegree.get(target) ?? 0) === 0) queue.push(target);
    }
  }

  const layers = new Map<string, number>();
  for (const id of ids) {
    const superId = superOf(id);
    layers.set(id, layer.get(superId) ?? 0);
  }
  return { layers, sccGroups, sccOf };
}

/* ------------------------------------------------------------------ */
/* Edge weights                                                        */
/* ------------------------------------------------------------------ */

export interface EdgeWeight {
  /** 1 = subtle background wiring, 3 = structurally significant */
  weight: 1 | 2 | 3;
  /** true when this edge belongs to a detected cycle */
  cycle: boolean;
}

/**
 * Assigns a stable three-step visual weight to every edge.
 *
 * Signal sources, in priority order: cycle membership (always strongest), unresolved status
 * (always weakest — noise), then backend importance of the endpoints. Node importance comes
 * from backend metrics so nothing here invents data.
 */
export function computeEdgeWeights(graph: DependencyGraphResult): EdgeWeight[] {
  const cyclePairs = new Set<string>();
  for (const cycle of graph.cycles) {
    for (let i = 0; i < cycle.files.length; i += 1) {
      const source = cycle.files[i];
      const target = cycle.files[(i + 1) % cycle.files.length];
      cyclePairs.add(`${source}->${target}`);
      cyclePairs.add(`${target}->${source}`);
    }
  }
  // Reverse-importance lookup: the most important nodes per backend ranking.
  const important = new Set(graph.importance_ranking.slice(0, Math.max(5, Math.ceil(graph.nodes.length * 0.2))));

  // Index-aligned with graph.edges so the canvas can style each edge without key collisions
  // (the backend may legitimately emit multiple edges between the same pair, e.g. one IMPORTS
  // and one EXTENDS).
  const weights: EdgeWeight[] = [];
  graph.edges.forEach((edge) => {
    let weight: 1 | 2 | 3 = 1;
    if (important.has(edge.source) || important.has(edge.target)) weight = 2;
    if (important.has(edge.source) && important.has(edge.target)) weight = 3;
    if (!edge.resolved) weight = 1;
    weights.push({
      weight,
      cycle: cyclePairs.has(`${edge.source}->${edge.target}`),
    });
  });
  return weights;
}

/**
 * Returns the selected node plus its direct dependencies and dependents — the set that stays
 * fully visible in focus mode while everything unrelated dims to 10–20% opacity.
 */
export function neighborhood(graph: DependencyGraphResult, id: string): Set<string> {
  const members = new Set<string>([id]);
  for (const edge of graph.edges) {
    if (edge.source === id) members.add(edge.target);
    if (edge.target === id) members.add(edge.source);
  }
  return members;
}

/* ------------------------------------------------------------------ */
/* Module grouping                                                     */
/* ------------------------------------------------------------------ */

export interface ModuleInfo {
  key: string;
  label: string;
  /** layer assigned to the module for layout (min of member layers) */
  layer: number;
  members: string[];
  fileCount: number;
}

const MODULE_LABEL_MAX = 42;

/**
 * Derives module clusters from actual file paths — no invented names.
 *
 * Strategy: group each file by its top-level directory (or its parent directory when the
 * nesting is deeper), merging tiny directories into their parent so the module list stays
 * readable. External/unresolved nodes are grouped under their own synthetic keys so they
 * never pollute file modules.
 */
export function computeModules(graph: DependencyGraphResult, layers: Map<string, number>): ModuleInfo[] {
  const groups = new Map<string, string[]>();
  const ensure = (key: string) => {
    if (!groups.has(key)) groups.set(key, []);
    return groups.get(key)!;
  };

  for (const node of graph.nodes) {
    if (node.node_type === "file") {
      ensure(moduleKeyForPath(node.path_name)).push(node.id);
    } else {
      ensure(node.node_type === "external" ? "::external" : "::unresolved").push(node.id);
    }
  }

  // Merge directories that hold very few files into their parent directory so the module
  // list does not explode into dozens of one-file clusters.
  const minCluster = 3;
  const merged = new Map<string, string[]>();
  for (const [key, members] of groups) {
    if (key.startsWith("::") || depthOf(key) <= 1 || members.length >= minCluster) {
      merged.set(key, members);
      continue;
    }
    const parent = parentKey(key);
    if (parent === null) {
      merged.set(key, members);
      continue;
    }
    if (!merged.has(parent)) merged.set(parent, []);
    merged.get(parent)!.push(...members);
  }

  const modules: ModuleInfo[] = [];
  for (const [key, members] of merged) {
    const layer = members.reduce((min, id) => Math.min(min, layers.get(id) ?? 0), Number.POSITIVE_INFINITY);
    modules.push({
      key,
      label: moduleLabel(key, members),
      layer: Number.isFinite(layer) ? layer : 0,
      members: [...members].sort(),
      fileCount: members.length,
    });
  }
  modules.sort((a, b) => a.layer - b.layer || a.key.localeCompare(b.key));
  return modules;
}

/** Top-level directory of a repo-relative path; files at the root are their own module. */
function moduleKeyForPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 2) return segments.length === 1 ? `::root:${path}` : `::root:${segments[0]}`;
  const directory = segments.slice(0, -1).join("/");
  return `::dir:${directory}`;
}

function depthOf(key: string): number {
  return key.slice(key.indexOf(":") + 1).split("/").length;
}

function parentKey(key: string): string | null {
  if (key.startsWith("::root:") || key.startsWith("::")) return null;
  const directory = key.slice("::dir:".length);
  const parent = directory.split("/").slice(0, -1).join("/");
  return parent ? `::dir:${parent}` : `::root:${directory.split("/")[0]}`;
}

function moduleLabel(key: string, members: string[]): string {
  if (key === "::external") return "external packages";
  if (key === "::unresolved") return "unresolved imports";
  if (key.startsWith("::root:")) {
    const target = key.slice("::root:".length);
    return target.length > MODULE_LABEL_MAX ? `${target.slice(0, MODULE_LABEL_MAX - 1)}…` : target;
  }
  const directory = key.slice("::dir:".length);
  return directory.length > MODULE_LABEL_MAX ? `${directory.slice(0, MODULE_LABEL_MAX - 1)}…` : directory;
}

/* ------------------------------------------------------------------ */
/* Structure (module-level) graph projection                           */
/* ------------------------------------------------------------------ */

export interface StructureEdge {
  source: string;
  target: string;
  weight: number;
  unresolved: boolean;
}

/**
 * Aggregates file-level edges into module-level edges (pure client-side transform of
 * existing backend edges — no new dependencies are invented).
 */
export function buildStructureGraph(graph: DependencyGraphResult, modules: ModuleInfo[]): { modules: ModuleInfo[]; edges: StructureEdge[] } {
  const moduleOf = new Map<string, string>();
  for (const module of modules) for (const member of module.members) moduleOf.set(member, module.key);

  const aggregated = new Map<string, StructureEdge>();
  for (const edge of graph.edges) {
    const source = moduleOf.get(edge.source);
    const target = moduleOf.get(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}->${target}`;
    const existing = aggregated.get(key) ?? { source, target, weight: 0, unresolved: false };
    existing.weight += 1;
    if (!edge.resolved) existing.unresolved = true;
    aggregated.set(key, existing);
  }
  return { modules, edges: [...aggregated.values()].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target)) };
}
