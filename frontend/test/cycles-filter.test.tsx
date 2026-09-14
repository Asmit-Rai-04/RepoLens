import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { applyFilter, capGraph, transformEdges, transformNodes } from "../lib/graph/dependency-graph";
import { DependencyGraphCanvas } from "../components/DependencyGraph";
import type { DependencyGraphResult } from "../lib/api/graph-types";

/**
 * Regression fixture for the pycycle defect: cycle detection succeeded and the sidebar listed
 * the cycle, but the CYCLES canvas rendered blank. The graph mirrors that shape — a larger
 * repository with a single 2-node cycle embedded among unrelated files, external, and
 * unresolved nodes.
 */
const graph: DependencyGraphResult = {
  nodes: [
    { id: "src/main.py", node_type: "file", path_name: "src/main.py", language: "python", metadata: {} },
    { id: "src/app.py", node_type: "file", path_name: "src/app.py", language: "python", metadata: {} },
    { id: "tests/_projects/relative_imports/myapp/managers.py", node_type: "file", path_name: "tests/_projects/relative_imports/myapp/managers.py", language: "python", metadata: {} },
    { id: "tests/_projects/relative_imports/myapp/models.py", node_type: "file", path_name: "tests/_projects/relative_imports/myapp/models.py", language: "python", metadata: {} },
    { id: "external:click", node_type: "external", path_name: "click", language: null, metadata: { classification: "external" } },
    { id: "external:os", node_type: "external", path_name: "os", language: null, metadata: { classification: "external" } },
    { id: "unresolved:ambiguous:b_module", node_type: "unresolved", path_name: "b_module", language: null, metadata: {} },
  ],
  edges: [
    { source: "src/main.py", target: "src/app.py", edge_type: "IMPORTS", resolved: true, import_evidence: { module: "app" }, source_file: "src/main.py", target_file: "src/app.py" },
    { source: "src/app.py", target: "external:click", edge_type: "IMPORTS", resolved: false, import_evidence: { module: "click", classification: "external" }, source_file: "src/app.py", target_file: null },
    { source: "src/main.py", target: "external:os", edge_type: "IMPORTS", resolved: false, import_evidence: { module: "os", classification: "external" }, source_file: "src/main.py", target_file: null },
    // The cycle: managers.py imports models.py AND models.py imports managers.py.
    { source: "tests/_projects/relative_imports/myapp/managers.py", target: "tests/_projects/relative_imports/myapp/models.py", edge_type: "IMPORTS", resolved: true, import_evidence: { module: ".models" }, source_file: "tests/_projects/relative_imports/myapp/managers.py", target_file: "tests/_projects/relative_imports/myapp/models.py" },
    { source: "tests/_projects/relative_imports/myapp/models.py", target: "tests/_projects/relative_imports/myapp/managers.py", edge_type: "IMPORTS", resolved: true, import_evidence: { module: ".managers" }, source_file: "tests/_projects/relative_imports/myapp/models.py", target_file: "tests/_projects/relative_imports/myapp/managers.py" },
    { source: "src/app.py", target: "unresolved:ambiguous:b_module", edge_type: "IMPORTS", resolved: false, import_evidence: { module: "b_module", classification: "ambiguous" }, source_file: "src/app.py", target_file: null },
  ],
  metrics: { node_metrics: {
    "src/main.py": { incoming_dependencies: 0, outgoing_dependencies: 2, degree: 2, betweenness_centrality: 0, importance: 2, rank: 1 },
    "src/app.py": { incoming_dependencies: 1, outgoing_dependencies: 2, degree: 3, betweenness_centrality: 0, importance: 3, rank: 2 },
  } },
  cycles: [{ files: ["tests/_projects/relative_imports/myapp/managers.py", "tests/_projects/relative_imports/myapp/models.py"], length: 2 }],
  cycles_truncated: false,
  strongly_connected_components: [["tests/_projects/relative_imports/myapp/managers.py", "tests/_projects/relative_imports/myapp/models.py"]],
  importance_ranking: ["src/app.py", "src/main.py"],
};

const CYCLE_FILES = ["tests/_projects/relative_imports/myapp/managers.py", "tests/_projects/relative_imports/myapp/models.py"];

describe("CYCLES filter regression (pycycle blank canvas)", () => {
  it("keeps both cycle nodes AND both directed cycle edges when filtering", () => {
    const filtered = applyFilter(graph, "CYCLES");
    expect(filtered.nodes.map((node) => node.id).sort()).toEqual([...CYCLE_FILES].sort());
    expect(filtered.edges).toHaveLength(2);
    expect(filtered.edges.map((edge) => [edge.source, edge.target]).sort()).toEqual(
      expect.arrayContaining([
        [CYCLE_FILES[0], CYCLE_FILES[1]],
        [CYCLE_FILES[1], CYCLE_FILES[0]],
      ]),
    );
  });

  it("keeps the cycle intact through the visualization cap", () => {
    const capped = capGraph(applyFilter(graph, "CYCLES"), 60);
    expect(capped.nodes).toHaveLength(2);
    expect(capped.edges).toHaveLength(2);
  });

  it("renders both cycle nodes with cycle styling and both directed edge payloads", () => {
    const filtered = applyFilter(graph, "CYCLES");
    const cycleIds = new Set(graph.cycles.flatMap((cycle) => cycle.files));
    const edges = transformEdges({ ...filtered, cycles: graph.cycles }, cycleIds, null);
    // Both directed edges carry the cycle-edge class used for the distinct cycle styling.
    expect(edges.map((edge) => edge.className)).toEqual([
      expect.stringContaining("edge-cycle"),
      expect.stringContaining("edge-cycle"),
    ]);
    expect(edges.every((edge) => edge.animated)).toBe(true);

    const { container } = render(
      <DependencyGraphCanvas graph={filtered} cycleIds={cycleIds} focusedIds={null} onSelect={() => {}} />,
    );
    // React Flow needs real DOM measurement to paint edges, which jsdom does not provide;
    // nodes and their cycle styling are the deterministic assertions here (edge presence in
    // the live browser is covered by the CDP verification of the same repository).
    expect(container.querySelectorAll(".react-flow__node")).toHaveLength(2);
    expect(container.querySelectorAll(".dependency-node.is-cycle")).toHaveLength(2);
    const cycleNodeNames = [...container.querySelectorAll(".dependency-node.is-cycle code")].map((el) => el.textContent);
    expect(cycleNodeNames).toEqual(expect.arrayContaining(CYCLE_FILES));
  });
});
