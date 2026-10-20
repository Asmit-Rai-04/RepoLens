"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, Handle, MiniMap, MarkerType, Position, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { DependencyGraphResult } from "../lib/api/graph-types";
import type { Visit } from "../lib/graph/workbench";
import { densePositions } from "../lib/graph/dense-layout";
import {
  transformEdges,
  transformNodes,
  type DependencyNode,
} from "../lib/graph/dependency-graph";
import { buildStructureGraph, computeLayers, computeModules, layerDAG, type ModuleInfo } from "../lib/graph/layout";

const COMPACT_NODE_WIDTH = 210;
const COMPACT_NODE_HEIGHT = 78;
const IMPORTANT_NODE_WIDTH = 240;
const IMPORTANT_NODE_HEIGHT = 86;

const NODE_LABELS = { file: "FILE", external: "EXTERNAL", unresolved: "UNRESOLVED" } as const;
type DependencyFlowNode = Node<Record<string, unknown>, "dependency">;

const DependencyNodeView = memo(function DependencyNodeView({ data }: NodeProps<DependencyNode>) {
  const label = NODE_LABELS[data.node.node_type];
  const classification = typeof data.node.metadata.classification === "string" ? data.node.metadata.classification : null;
  const fileName = data.node.path_name.split("/").pop() ?? data.node.path_name;
  const directory = data.node.path_name.includes("/") ? `${data.node.path_name.slice(0, data.node.path_name.length - fileName.length)}…` : null;
  const important = data.weight === 3;
  return (
    <div
      className={`dependency-node node-${data.node.node_type}${data.cycle ? " is-cycle" : ""}${important ? " is-important" : ""}${!data.focused ? " is-dimmed" : ""}${typeof data.impactDepth === "number" && data.impactDepth > 1 ? " is-transitive" : ""}`}
      title={data.node.path_name}
    >
      <Handle type="target" position={data.vertical ? Position.Top : Position.Left} className="flow-handle" />
      <div className="dependency-node-kicker">
        <span>{label}</span>
        {typeof data.impactDepth === "number" && data.impactDepth > 0 ? <span>{data.impactDepth === 1 ? "DIRECT" : `DEPTH ${data.impactDepth}`}</span> : null}
        {data.cycle ? <span className="dependency-node-cycleflag">CYCLE</span> : null}
      </div>
      <code className="dependency-node-name">{data.node.id.startsWith("module:") ? data.node.path_name : fileName}</code>
      <div className="dependency-node-meta">
        <span>{directory ?? data.node.language ?? classification ?? "dependency"}</span>
        {data.metrics ? <span>#{data.metrics.rank}</span> : <span>—</span>}
      </div>
      <Handle type="source" position={data.vertical ? Position.Bottom : Position.Right} className="flow-handle" />
    </div>
  );
});

const nodeTypes = { dependency: DependencyNodeView };

interface LayoutOptions {
  compact?: boolean;
  vertical?: boolean;
  /** Layer spacing; larger for module view so group cards breathe. */
  ranksep: number;
  nodesep: number;
  width: (node: DependencyNode) => number;
  height: (node: DependencyNode) => number;
}

function layout(nodes: DependencyNode[], edges: Edge[], options: LayoutOptions): DependencyNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: options.vertical ? "TB" : "LR", ranksep: options.vertical ? 50 : options.compact ? 65 : options.ranksep, nodesep: options.compact ? 12 : options.nodesep, marginx: 30, marginy: 30 });
  nodes.forEach((node) => graph.setNode(node.id, { width: options.width(node), height: options.height(node) }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return nodes.map((node) => {
    const width = options.width(node);
    const height = options.height(node);
    const point = graph.node(node.id);
    return { ...node, width, height, initialWidth: width, initialHeight: height, position: { x: point.x - width / 2, y: point.y - height / 2 }, sourcePosition: options.vertical ? Position.Bottom : Position.Right, targetPosition: options.vertical ? Position.Top : Position.Left };
  });
}

/**
 * Re-fits the viewport when the rendered node set changes.
 *
 * The `fitView` prop only applies on mount, so switching a filter (e.g. ALL → CYCLES) used to
 * swap in a much smaller re-laid-out graph while the viewport stayed fitted to the old layout —
 * the new nodes sat outside the visible pane and the canvas looked blank. The signature covers
 * the node ids and edge count, so unrelated re-renders keep the user's viewport. The first
 * render is skipped on purpose: the `fitView` prop already fits on mount, and an early
 * programmatic fit would race and reset it.
 */
function FitOnChange({ signature }: { signature: string }) {
  const { fitView } = useReactFlow();
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    // React Flow measures the DOM in its own effects; a short delay lets the new layout settle.
    const timer = window.setTimeout(() => {
      void fitView({ padding: 0.15, duration: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 200, maxZoom: 1.8 }).catch(() => undefined);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [signature, fitView]);
  return null;
}

function SelectionControl({ selectedId }: { selectedId?: string | null }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (!selectedId) return;
    const timer = window.setTimeout(() => { void fitView({ nodes: [{ id: selectedId }], padding: 0.7, maxZoom: 1.3, duration: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 180 }); }, 130);
    return () => window.clearTimeout(timer);
  }, [selectedId, fitView]);
  return <button type="button" className="canvas-selection secondary-button compact-button" disabled={!selectedId} onClick={() => void fitView({ nodes: selectedId ? [{ id: selectedId }] : [], padding: 0.7, maxZoom: 1.3, duration: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 180 })}>Fit selection</button>;
}

export function DependencyGraphCanvas({ graph, cycleIds, focusedIds, onSelect, selectedId, layoutMode = "hierarchical", minimap = true, impactVisits }: { graph: DependencyGraphResult; cycleIds: Set<string>; focusedIds: Set<string> | null; onSelect: (id: string) => void; selectedId?: string | null; layoutMode?: "hierarchical" | "compact"; minimap?: boolean; impactVisits?: Map<string, Visit> }) {
  const [vertical, setVertical] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 768px)");
    const update = () => setVertical(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  // Geometry depends only on dataset/layout. Selection and spotlight never run Dagre.
  const geometry = useMemo(() => {
    const structure = computeLayers(graph);
    const dense = graph.edges.length > graph.nodes.length * 4 || [...structure.sccGroups.values()].some(members => members.length > 12);
    const importantIds = new Set(graph.importance_ranking.slice(0, Math.max(5, Math.ceil(graph.nodes.length * 0.2))));
    const edges = transformEdges(graph, cycleIds, null).map(edge => ({ ...edge, type: dense ? "straight" : "smoothstep", animated: false, markerEnd: { type: MarkerType.ArrowClosed, color: "#a1a1aa" }, label: graph.nodes[0]?.id.startsWith("module:") ? String(edge.data?.edge.import_evidence.count ?? "") : undefined }));
    const nodes = transformNodes(graph, cycleIds, null, importantIds).map(node => ({ ...node, data: { ...node.data, vertical } }));
    const grid = dense ? densePositions(graph, layoutMode === "compact", vertical, structure.layers) : null;
    const laid = grid ? nodes.map(node => ({ ...node, width: node.data.weight === 3 ? IMPORTANT_NODE_WIDTH : COMPACT_NODE_WIDTH, height: node.data.weight === 3 ? IMPORTANT_NODE_HEIGHT : COMPACT_NODE_HEIGHT, position: grid.get(node.id)!, sourcePosition: vertical ? Position.Bottom : Position.Right, targetPosition: vertical ? Position.Top : Position.Left })) : layout(nodes, edges, {
      ranksep: 120,
      compact: layoutMode === "compact",
      vertical,
      nodesep: 22,
      width: (node) => (node.data.weight === 3 ? IMPORTANT_NODE_WIDTH : COMPACT_NODE_WIDTH),
      height: (node) => (node.data.weight === 3 ? IMPORTANT_NODE_HEIGHT : COMPACT_NODE_HEIGHT),
    });
    return { nodes: laid, edges };
  }, [graph, cycleIds, layoutMode, vertical]);
  const flow = useMemo(() => ({
    nodes: geometry.nodes.map(node => ({ ...node, selected: node.id === selectedId, data: { ...node.data, impactDepth: impactVisits?.get(node.id)?.depth, focused: !focusedIds || focusedIds.has(node.id) } })),
    edges: geometry.edges.map(edge => ({ ...edge, className: `${edge.className ?? ""}${focusedIds && !(focusedIds.has(edge.source) && focusedIds.has(edge.target)) ? " edge-dim" : ""}` })),
  }), [geometry, focusedIds, selectedId, impactVisits]);
  const colors = useMemo(() => new Map(graph.nodes.map(node => [node.id, node.node_type === "file" ? "#A1A1AA" : "#F95738"])), [graph]);
  const select = useCallback((_: unknown, node: Node) => onSelect(node.id), [onSelect]);
  const signature = useMemo(() => `${geometry.nodes.map((node) => node.id).join("\n")}#${geometry.edges.length}#${layoutMode}#${vertical}`, [geometry, layoutMode, vertical]);

  return (
    <div className="dependency-canvas" aria-label="Interactive file dependency graph">
      <ReactFlowProvider>
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={nodeTypes}
          fitView
          minZoom={0.2}
          maxZoom={1.8}
          defaultEdgeOptions={{ type: "smoothstep" }}
          nodesDraggable
          nodesConnectable={false}
          onlyRenderVisibleElements
          onNodeClick={select}
        >
          <FitOnChange signature={signature} />
          <Background gap={24} size={1} color="#27272A" />
          <Controls position="bottom-left" showInteractive={false} />
          <SelectionControl selectedId={selectedId} />
          {minimap ? <MiniMap
            pannable
            zoomable
            nodeColor={(node: DependencyFlowNode) => colors.get(node.id) ?? "#A1A1AA"}
            nodeStrokeColor={() => "#27272A"}
            maskColor="rgba(9, 9, 11, 0.75)"
            style={{ background: "#0D0D10", border: "1px solid #27272A" }}
          /> : null}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function nodeColorFor(id: string, graph: DependencyGraphResult): string {
  const node = graph.nodes.find((item) => item.id === id);
  if (node?.node_type === "external") return "#52525B";
  if (node?.node_type === "unresolved") return "#F95738";
  if (graph.cycles.some((cycle) => cycle.files.includes(id))) return "#F95738";
  return "#A1A1AA";
}

/* ------------------------------------------------------------------ */
/* Structure view: module-level aggregated projection                   */
/* ------------------------------------------------------------------ */

const MODULE_WIDTH = 220;
const MODULE_HEIGHT = 76;

interface StructureModuleData extends Record<string, unknown> {
  label: string;
  fileCount: number;
  cycleMembers: number;
  isExternal: boolean;
  isUnresolved: boolean;
  title: string;
  meta: string;
}

type StructureFlowNode = Node<StructureModuleData, "structureModule">;

function StructureModuleView({ data }: NodeProps<StructureFlowNode>) {
  return (
    <div className={`module-node${data.isExternal ? " module-external" : ""}${data.isUnresolved ? " module-unresolved" : ""}${data.cycleMembers > 0 ? " module-cycle" : ""}`} title={data.title}>
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="module-node-kicker">MODULE · {data.fileCount} FILE{data.fileCount === 1 ? "" : "S"}</div>
      <code className="module-node-name">{data.label}</code>
      <div className="module-node-meta"><span>{data.meta}</span></div>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  );
}

const structureNodeTypes = { structureModule: StructureModuleView };

/**
 * Module-level "architecture map" of the repository.
 *
 * Files are grouped by their actual top-level directories (client-side only — no invented
 * backend data), file edges are aggregated into module edges with a connection count, and the
 * module graph is layered with the same deterministic SCC-condensed longest-path ranking as the
 * file view. Clicking a module opens the file view focused on that directory via search.
 */
export function DependencyStructureCanvas({ graph, cycleIds, onSelect }: { graph: DependencyGraphResult; cycleIds: Set<string>; onSelect: (moduleKey: string) => void }) {
  const flow = useMemo(() => {
    const { layers } = computeLayers(graph);
    const modules = computeModules(graph, layers);
    const structure = buildStructureGraph(graph, modules);
    const byKey = new Map(modules.map((module) => [module.key, module]));

    const nodes: Node[] = structure.modules.map((module: ModuleInfo) => {
      const cycleMembers = module.members.filter((id) => cycleIds.has(id)).length;
      const isExternal = module.key === "::external";
      const isUnresolved = module.key === "::unresolved";
      return {
        id: module.key,
        type: "structureModule" as const,
        position: { x: 0, y: 0 },
        data: {
          label: module.label,
          fileCount: module.fileCount,
          cycleMembers,
          isExternal,
          isUnresolved,
          title: module.members.length <= 6 ? module.members.join("\n") : `${module.members.slice(0, 6).join("\n")}\n… +${module.members.length - 6} more`,
          meta: cycleMembers > 0 ? `${cycleMembers} file${cycleMembers === 1 ? "" : "s"} in cycles` : module.fileCount >= 3 ? "high cohesion" : "small module",
        },
      };
    });

    const edges: Edge[] = structure.edges.map((edge, index) => {
      const sourceModule = byKey.get(edge.source);
      const targetModule = byKey.get(edge.target);
      const sourceLayer = sourceModule?.layer ?? 0;
      const targetLayer = targetModule?.layer ?? 0;
      // Cross-tier back-references keep a subtle tint so the hierarchy stays readable.
      const backReference = targetLayer < sourceLayer;
      return {
        id: `structure-${index}-${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: `${edge.weight}`,
        className: ["module-edge", edge.weight >= 8 ? "module-edge-strong" : edge.weight >= 3 ? "module-edge-medium" : "", backReference ? "module-edge-backref" : ""].filter(Boolean).join(" "),
      };
    });

    // Layer modules with the DAG layering over the aggregated edges, then position with dagre.
    const layerById = layerDAG(structure.modules.map((module) => module.key), structure.edges);
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({ rankdir: "LR", ranksep: 150, nodesep: 40, marginx: 40, marginy: 40 });
    nodes.forEach((node) => dagreGraph.setNode(node.id, { width: MODULE_WIDTH, height: MODULE_HEIGHT }));
    edges.forEach((edge) => dagreGraph.setEdge(edge.source, edge.target));
    dagre.layout(dagreGraph);
    const positioned = nodes.map((node) => {
      const point = dagreGraph.node(node.id);
      return { ...node, position: { x: point.x - MODULE_WIDTH / 2, y: point.y - MODULE_HEIGHT / 2 } };
    });
    void layerById;
    return { nodes: positioned, edges };
  }, [graph, cycleIds]);

  const signature = useMemo(() => `${flow.nodes.map((node) => node.id).join("\n")}#${flow.edges.length}`, [flow]);

  return (
    <div className="dependency-canvas" aria-label="Module structure graph">
      <ReactFlowProvider>
        <ReactFlow
          nodes={flow.nodes}
          edges={flow.edges}
          nodeTypes={structureNodeTypes}
          fitView
          minZoom={0.2}
          maxZoom={1.8}
          defaultEdgeOptions={{ type: "smoothstep" }}
          nodesDraggable
          nodesConnectable={false}
          onNodeClick={(_, node) => onSelect(node.id)}
        >
          <FitOnChange signature={signature} />
          <Background gap={28} size={1} color="#27272A" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#52525B" nodeStrokeColor={() => "#27272A"} maskColor="rgba(9, 9, 11, 0.75)" style={{ background: "#0D0D10", border: "1px solid #27272A" }} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
