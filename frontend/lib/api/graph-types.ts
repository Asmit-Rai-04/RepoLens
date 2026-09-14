export type GraphNodeType = "file" | "external" | "unresolved";
export type GraphEdgeType = "IMPORTS" | "EXTENDS" | "IMPLEMENTS";

export interface GraphNode {
  id: string;
  node_type: GraphNodeType;
  path_name: string;
  language: string | null;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  edge_type: GraphEdgeType;
  resolved: boolean;
  import_evidence: Record<string, unknown>;
  source_file: string;
  target_file: string | null;
}

export interface NodeMetrics {
  incoming_dependencies: number;
  outgoing_dependencies: number;
  degree: number;
  betweenness_centrality: number;
  importance: number;
  rank: number;
}

export interface DependencyGraphResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metrics: { node_metrics: Record<string, NodeMetrics> };
  cycles: Array<{ files: string[]; length: number }>;
  /** True when a strongly connected component holds more cycles than are reported. */
  cycles_truncated: boolean;
  strongly_connected_components: string[][];
  importance_ranking: string[];
}
