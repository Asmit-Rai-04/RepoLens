// @vitest-environment node
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DependencyGraphResult } from "../lib/api/graph-types";
import {
  neighborhood,
  computeLayers,
  computeModules,
  buildStructureGraph,
} from "../lib/graph/layout";
import {
  aggregateModules,
  indexGraph,
  searchIndex,
  subsetGraph,
  traverse,
} from "../lib/graph/workbench";
import { densePositions } from "../lib/graph/dense-layout";

function fixture(size: number, density: number): DependencyGraphResult {
  const nodes = Array.from({ length: size }, (_, i) => ({
    id: `src/module${i % 10}/file${i}.ts`,
    path_name: `src/module${i % 10}/file${i}.ts`,
    node_type: "file" as const,
    language: "typescript",
    metadata: {},
  }));
  const edges = nodes.flatMap((node, i) =>
    Array.from({ length: Math.min(density, size - 1) }, (_, j) => {
      const target = nodes[(i + j + 1) % size].id;
      return {
        source: node.id,
        target,
        edge_type: "IMPORTS" as const,
        resolved: true,
        source_file: node.id,
        target_file: target,
        import_evidence: {},
      };
    }),
  );
  return {
    nodes,
    edges,
    metrics: { node_metrics: {} },
    cycles: [],
    cycles_truncated: false,
    strongly_connected_components: [],
    importance_ranking: [],
  };
}
function medianMs(run: () => unknown, iterations = 25) {
  for (let i = 0; i < 5; i++) run();
  const samples = Array.from({ length: iterations }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  });
  return Number(
    samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)].toFixed(4),
  );
}
describe("representative graph performance", () => {
  it("measures baseline scans versus indexed interaction and bounded projection", () => {
    const measurements = [20, 100, 500, 1500].flatMap((size) =>
      [3, 16].map((density) => {
        const graph = fixture(size, density);
        const index = indexGraph(graph);
        const id = graph.nodes[0].id;
        expect(traverse(index, id, "both", 1).size).toBe(
          neighborhood(graph, id).size,
        );
        const projection = aggregateModules(graph, index);
        const bounded = subsetGraph(
          graph,
          new Set(graph.nodes.slice(0, 100).map((node) => node.id)),
        );
        expect(projection.nodes.length).toBeLessThanOrEqual(10);
        expect(traverse(index, id, "dependents").size).toBe(size);
        return {
          nodes: size,
          edges: graph.edges.length,
          indexBuildMs: medianMs(() => indexGraph(graph)),
          beforeSelectionMs: medianMs(() => {
            for (let i = 0; i < 100; i++) neighborhood(graph, id);
          }),
          afterSelectionMs: medianMs(() => {
            for (let i = 0; i < 100; i++) traverse(index, id, "both", 1);
          }),
          beforeModuleDerivationMs: medianMs(() =>
            buildStructureGraph(
              graph,
              computeModules(graph, computeLayers(graph).layers),
            ),
          ),
          afterModuleDerivationMs: medianMs(() =>
            aggregateModules(graph, index),
          ),
          searchMs: medianMs(() => searchIndex(index, "file149")),
          transitiveImpactMs: medianMs(() => traverse(index, id, "dependents")),
          denseLayoutMs: medianMs(() => densePositions(bounded)),
          initialModuleNodes: projection.nodes.length,
        };
      }),
    );
    mkdirSync("../.verification", { recursive: true });
    writeFileSync(
      "../.verification/performance.json",
      JSON.stringify(
        {
          method:
            "Median of 25 samples after 5 warmups; selection samples batch 100 interactions; Node/V8, synthetic deterministic cyclic graphs, indexes built once. Baseline algorithms retained from GitHub main. Not browser FPS or heap measurements.",
          measurements,
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify(measurements));
  });
});
