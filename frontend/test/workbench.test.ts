import { describe, expect, it } from "vitest";
import { demoGraph } from "../lib/graph/demo";
import {
  aggregateModules,
  dependencyPath,
  filterGraph,
  indexGraph,
  readWorkspaceState,
  searchIndex,
  subsetGraph,
  traverse,
  workspaceParams,
} from "../lib/graph/workbench";
import { transformEdges } from "../lib/graph/dependency-graph";
import { densePositions } from "../lib/graph/dense-layout";

describe("graph workbench foundations", () => {
  const index = indexGraph(demoGraph);
  it("keeps real external/unresolved directories separate from dependency groups", () => {
    const graph = {
      ...demoGraph,
      nodes: [
        ...demoGraph.nodes,
        {
          ...demoGraph.nodes[0],
          id: "external/helper.ts",
          path_name: "external/helper.ts",
        },
        {
          ...demoGraph.nodes[0],
          id: "external:pkg",
          path_name: "pkg",
          node_type: "external" as const,
        },
      ],
    };
    const grouped = indexGraph(graph);
    expect(grouped.moduleByNode.get("external/helper.ts")).not.toBe(
      grouped.moduleByNode.get("external:pkg"),
    );
    expect(
      aggregateModules(graph, grouped).nodes.find(
        (node) => node.id === "module:type:external",
      )?.node_type,
    ).toBe("external");
  });
  it("preserves importer → dependency direction and shortest reverse paths", () => {
    const direct = traverse(index, "data/store.ts", "dependents", 1);
    expect([...direct.keys()]).toEqual(["data/store.ts", "domain/orders.ts"]);
    const all = traverse(index, "data/store.ts", "dependents");
    expect(all.get("ui/app.ts")?.depth).toBe(3);
    expect(dependencyPath(all, "ui/app.ts")).toEqual([
      "ui/app.ts",
      "ui/cart.ts",
      "domain/orders.ts",
      "data/store.ts",
    ]);
    expect(all.has("shared/types.ts")).toBe(false);
    expect(
      traverse(index, "data/store.ts", "dependencies", 1).has("data/cache.ts"),
    ).toBe(true);
    expect(
      traverse(index, "data/store.ts", "both", 1).has("domain/orders.ts"),
    ).toBe(true);
  });
  it("handles cycles without duplicating the start and obeys depth", () => {
    const result = traverse(index, "domain/orders.ts", "dependents");
    expect(result.get("domain/orders.ts")?.depth).toBe(0);
    expect(
      [...result.keys()].filter((id) => id === "domain/orders.ts"),
    ).toHaveLength(1);
    expect(
      traverse(index, "data/store.ts", "dependents", 2).has("ui/app.ts"),
    ).toBe(false);
  });
  it("aggregates only real cross-directory relationships with deterministic IDs", () => {
    const modules = aggregateModules(demoGraph, index);
    expect(modules.nodes).toHaveLength(4);
    const edge = modules.edges.find(
      (edge) =>
        edge.source === "module:dir:ui" && edge.target === "module:dir:domain",
    );
    expect(edge?.import_evidence.count).toBe(2);
    expect(modules.edges.some((edge) => edge.source === edge.target)).toBe(
      false,
    );
    expect(
      indexGraph({ ...demoGraph, nodes: [...demoGraph.nodes].reverse() })
        .modules,
    ).toEqual(index.modules);
    expect(modules.metrics.node_metrics).toEqual({});
  });
  it("supports empty/disconnected graphs and unknown nodes", () => {
    const empty = { ...demoGraph, nodes: [], edges: [], cycles: [] };
    expect(indexGraph(empty).modules).toEqual([]);
    expect(traverse(indexGraph(empty), "missing", "both").size).toBe(0);
    const disconnected = indexGraph({ ...demoGraph, edges: [] });
    expect(traverse(disconnected, "ui/app.ts", "both").size).toBe(1);
  });
  it("retains importers in unresolved/external filters and respects cycle filtering", () => {
    const graph = {
      ...demoGraph,
      nodes: [
        ...demoGraph.nodes,
        {
          id: "external:x",
          path_name: "x",
          node_type: "external" as const,
          language: null,
          metadata: {},
        },
      ],
      edges: [
        ...demoGraph.edges,
        { ...demoGraph.edges[0], source: "ui/app.ts", target: "external:x" },
      ],
    };
    const filtered = filterGraph(graph, indexGraph(graph), "EXTERNAL");
    expect(filtered.nodes.map((node) => node.id)).toEqual([
      "ui/app.ts",
      "external:x",
    ]);
    expect(filtered.edges).toHaveLength(1);
    expect(filterGraph(demoGraph, index, "CYCLES").nodes).toHaveLength(2);
    expect(filterGraph(demoGraph, index, "UNRESOLVED").nodes).toHaveLength(0);
  });
  it("searches real files, modules and reported cycles", () => {
    expect(searchIndex(index, "store").map((result) => result.id)).toEqual([
      "data/store.ts",
    ]);
    expect(searchIndex(index, "cycle 1")[0].category).toBe("Cycle");
    expect(
      searchIndex(index, "ui").some((result) => result.id === "module:dir:ui"),
    ).toBe(true);
    expect(searchIndex(index, "nonexistent")).toEqual([]);
  });
  it("keeps edge IDs stable when a view is filtered", () => {
    const full = transformEdges(demoGraph);
    const small = transformEdges(
      subsetGraph(demoGraph, new Set(["data/store.ts", "data/cache.ts"])),
    );
    expect(small[0].id).toBe(
      full.find(
        (edge) =>
          edge.source === "data/store.ts" && edge.target === "data/cache.ts",
      )?.id,
    );
  });
  it("places dense cycle members without overlap and remains deterministic", () => {
    const positions = densePositions(demoGraph);
    expect(positions.size).toBe(demoGraph.nodes.length);
    expect(
      densePositions({ ...demoGraph, nodes: [...demoGraph.nodes].reverse() }),
    ).toEqual(positions);
    for (const [id, a] of positions)
      for (const [other, b] of positions)
        if (id !== other)
          expect(Math.abs(a.x - b.x) >= 240 || Math.abs(a.y - b.y) >= 86).toBe(
            true,
          );
    expect(densePositions(demoGraph, true)).not.toEqual(positions);
  });
  it("round-trips legacy cycle links and rejects invalid parameters", () => {
    const state = readWorkspaceState(
      new URLSearchParams(
        "cycle=domain/orders.ts,domain/events.ts&focus=impact&depth=all&layout=compact",
      ),
      demoGraph,
    );
    expect(state.cycle).toBe(0);
    expect(workspaceParams(state, demoGraph).get("cycleIndex")).toBe("0");
    expect(workspaceParams(state, demoGraph).has("cycle")).toBe(false);
    expect(state.level).toBe("files");
    expect(state.depth).toBe(Infinity);
    expect(
      readWorkspaceState(workspaceParams(state, demoGraph), demoGraph),
    ).toEqual(state);
    expect(
      readWorkspaceState(
        new URLSearchParams("file=missing&filter=fake"),
        demoGraph,
      ).file,
    ).toBe(null);
  });
});
