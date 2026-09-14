import { describe, expect, it } from "vitest";
import { applyFilter, capGraph, focusMembers, searchNodes, transformEdges, transformNodes } from "../lib/graph/dependency-graph";
import type { DependencyGraphResult } from "../lib/api/graph-types";

const graph: DependencyGraphResult = {
  nodes: [
    { id: "a.py", node_type: "file", path_name: "a.py", language: "python", metadata: {} },
    { id: "b.py", node_type: "file", path_name: "b.py", language: "python", metadata: {} },
    { id: "external:requests", node_type: "external", path_name: "requests", language: null, metadata: { classification: "external" } },
    { id: "unresolved:local:missing", node_type: "unresolved", path_name: "./missing", language: null, metadata: { classification: "unresolved_internal" } },
  ],
  edges: [
    { source: "a.py", target: "b.py", edge_type: "IMPORTS", resolved: true, import_evidence: { module: "b" }, source_file: "a.py", target_file: "b.py" },
    { source: "a.py", target: "external:requests", edge_type: "IMPORTS", resolved: false, import_evidence: { module: "requests", classification: "external" }, source_file: "a.py", target_file: null },
    { source: "b.py", target: "unresolved:local:missing", edge_type: "IMPORTS", resolved: false, import_evidence: { module: "./missing", classification: "unresolved_internal" }, source_file: "b.py", target_file: null },
  ],
  metrics: { node_metrics: {
    "a.py": { incoming_dependencies: 0, outgoing_dependencies: 1, degree: 1, betweenness_centrality: 0.5, importance: 1.5, rank: 1 },
    "b.py": { incoming_dependencies: 1, outgoing_dependencies: 0, degree: 1, betweenness_centrality: 0, importance: 1, rank: 2 },
  } },
  cycles: [{ files: ["a.py", "b.py"], length: 2 }],
  cycles_truncated: false,
  strongly_connected_components: [["a.py", "b.py"]],
  importance_ranking: ["a.py", "b.py"],
};

describe("dependency graph transformations", () => {
  it("classifies nodes and preserves backend edge semantics", () => {
    expect(graph.nodes.find((node) => node.id.startsWith("external:"))?.node_type).toBe("external");
    expect(graph.nodes.find((node) => node.id.startsWith("unresolved:"))?.node_type).toBe("unresolved");
    expect(transformEdges(graph)[1].data?.edge.import_evidence.module).toBe("requests");
    expect(transformNodes(graph)[0].data.metrics?.rank).toBe(1);
  });

  it("filters without recomputing graph semantics", () => {
    expect(applyFilter(graph, "EXTERNAL").nodes.map((node) => node.id)).toEqual(["external:requests"]);
    expect(applyFilter(graph, "UNRESOLVED").nodes.map((node) => node.id)).toEqual(["unresolved:local:missing"]);
    expect(applyFilter(graph, "CYCLES").nodes.map((node) => node.id)).toEqual(["a.py", "b.py"]);
  });

  it("supports deterministic search and focus", () => {
    expect([...searchNodes(graph, "REQUEST")]).toEqual(["external:requests"]);
    expect(focusMembers(graph, ["a.py", "b.py"]).edges).toHaveLength(1);
  });

  it("caps by backend importance and keeps connected neighbors where possible", () => {
    const capped = capGraph(graph, 2);
    expect(capped.truncated).toBe(true);
    expect(capped.nodes.map((node) => node.id)).toEqual(["a.py", "b.py"]);
    expect(capped.edges).toHaveLength(1);
    expect(capped.totalNodeCount).toBe(4);
  });

  it("fills the cap for nodes the backend importance ranking does not cover", () => {
    // External and unresolved nodes never appear in importance_ranking, so a filter that
    // selects only them must still render by falling back to in-view degree.
    const externals = Array.from({ length: 5 }, (_, index) => ({
      id: `external:pkg${index}`,
      node_type: "external" as const,
      path_name: `pkg${index}`,
      language: null,
      metadata: {},
    }));
    const wide: DependencyGraphResult = {
      ...graph,
      nodes: [...graph.nodes, ...externals],
      metrics: { node_metrics: graph.metrics.node_metrics },
    };
    const filtered = applyFilter(wide, "EXTERNAL");
    const capped = capGraph(filtered, 3);
    expect(capped.nodes).toHaveLength(3);
    expect(capped.nodes.every((node) => node.node_type === "external")).toBe(true);
    // Deterministic: identical input produces identical output.
    expect(capGraph(filtered, 3).nodes.map((node) => node.id)).toEqual(capped.nodes.map((node) => node.id));
  });

  it("always keeps a deep-linked file even when it is not highly ranked", () => {
    const capped = capGraph(graph, 2, ["unresolved:local:missing"]);
    expect(capped.nodes.map((node) => node.id)).toContain("unresolved:local:missing");
  });
});
