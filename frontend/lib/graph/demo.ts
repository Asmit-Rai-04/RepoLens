import type { DependencyGraphResult, GraphEdge } from "../api/graph-types";

/** Fictional Parcel v1: a UI → domain → data example, never an analysis of a real repository. */
const files = [
  "ui/app.ts",
  "ui/cart.ts",
  "ui/checkout.ts",
  "domain/orders.ts",
  "domain/pricing.ts",
  "domain/events.ts",
  "data/store.ts",
  "data/cache.ts",
  "shared/types.ts",
  "shared/format.ts",
];
const imports = [
  [0, 1],
  [0, 2],
  [1, 3],
  [1, 9],
  [2, 3],
  [3, 4],
  [3, 5],
  [3, 6],
  [4, 8],
  [5, 3],
  [6, 7],
  [6, 8],
  [7, 8],
  [9, 8],
];
const edges: GraphEdge[] = imports.map(([source, target], i) => ({
  source: files[source],
  target: files[target],
  edge_type: "IMPORTS",
  resolved: true,
  source_file: files[source],
  target_file: files[target],
  import_evidence: {
    module: files[target],
    line: i + 1,
    origin: "fictional fixture",
  },
}));
export const demoGraph: DependencyGraphResult = {
  nodes: files.map((path) => ({
    id: path,
    path_name: path,
    node_type: "file",
    language: "TypeScript",
    metadata: { symbols: [path.split("/").pop()!.replace(".ts", "")] },
  })),
  edges,
  metrics: { node_metrics: {} },
  cycles: [{ files: ["domain/orders.ts", "domain/events.ts"], length: 2 }],
  cycles_truncated: false,
  strongly_connected_components: [["domain/orders.ts", "domain/events.ts"]],
  importance_ranking: [],
};
