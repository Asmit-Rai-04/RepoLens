import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import dagre from "@dagrejs/dagre";
import { DependencyGraphCanvas } from "../components/DependencyGraph";
import { demoGraph } from "../lib/graph/demo";

describe("canvas geometry stability", () => {
  it("uses SCC grid placement for large sparse cycles without invoking Dagre", () => {
    const layout = vi.spyOn(dagre, "layout");
    const nodes = Array.from({ length: 15 }, (_, i) => ({
      ...demoGraph.nodes[0],
      id: `src/file${i}.ts`,
      path_name: `src/file${i}.ts`,
    }));
    const graph = {
      ...demoGraph,
      nodes,
      edges: nodes.map((node, i) => ({
        ...demoGraph.edges[0],
        source: node.id,
        target: nodes[(i + 1) % nodes.length].id,
        source_file: node.id,
        target_file: nodes[(i + 1) % nodes.length].id,
      })),
      cycles: [{ files: nodes.map((node) => node.id), length: nodes.length }],
    };
    render(
      <DependencyGraphCanvas
        graph={graph}
        cycleIds={new Set(nodes.map((node) => node.id))}
        focusedIds={null}
        onSelect={() => {}}
      />,
    );
    expect(layout).not.toHaveBeenCalled();
    layout.mockRestore();
  });
  it("does not rerun Dagre when selection/spotlight changes; changes layout when requested", () => {
    const layout = vi.spyOn(dagre, "layout");
    const cycles = new Set<string>();
    const choose = () => {};
    const { rerender } = render(
      <DependencyGraphCanvas
        graph={demoGraph}
        cycleIds={cycles}
        focusedIds={null}
        onSelect={choose}
      />,
    );
    expect(layout).toHaveBeenCalledTimes(1);
    rerender(
      <DependencyGraphCanvas
        graph={demoGraph}
        cycleIds={cycles}
        focusedIds={new Set(["data/store.ts"])}
        selectedId="data/store.ts"
        onSelect={choose}
      />,
    );
    expect(layout).toHaveBeenCalledTimes(1);
    rerender(
      <DependencyGraphCanvas
        graph={demoGraph}
        cycleIds={cycles}
        focusedIds={null}
        onSelect={choose}
        layoutMode="compact"
      />,
    );
    expect(layout).toHaveBeenCalledTimes(2);
    layout.mockRestore();
  });
});
