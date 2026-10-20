import type { DependencyGraphResult } from "../api/graph-types";
import { computeLayers } from "./layout";

/** Dense cyclic views avoid Dagre's expensive crossing minimization.
 * SCC-condensed dependency layers retain flow; stable grids within layers prevent overlap.
 * Coordinates are presentation only and do not assert architectural boundaries. */
export function densePositions(
  graph: DependencyGraphResult,
  compact = false,
  vertical = false,
  cachedLayers?: Map<string, number>,
): Map<string, { x: number; y: number }> {
  const layers = cachedLayers ?? computeLayers(graph).layers;
  const groups = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const rank = layers.get(node.id) ?? 0;
    const members = groups.get(rank) ?? [];
    members.push(node.id);
    groups.set(rank, members);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const columnStep = compact ? 270 : 300;
  const rowStep = compact ? 110 : 135;
  let offset = 30;
  for (const [, ids] of [...groups].sort(([a], [b]) => a - b)) {
    ids.sort();
    const columns = Math.max(1, Math.ceil(Math.sqrt(ids.length)));
    ids.forEach((id, i) =>
      positions.set(
        id,
        vertical
          ? {
              x: 30 + (i % columns) * columnStep,
              y: offset + Math.floor(i / columns) * rowStep,
            }
          : {
              x: offset + (i % columns) * columnStep,
              y: 30 + Math.floor(i / columns) * rowStep,
            },
      ),
    );
    offset += vertical
      ? Math.ceil(ids.length / columns) * rowStep + 70
      : columns * columnStep + 90;
  }
  return positions;
}
