"use client";

import { useEffect, useMemo, useRef } from "react";
import { ReactFlow, ReactFlowProvider, Background, Controls, Handle, MiniMap, Position, useReactFlow, type Edge, type Node, type NodeProps } from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { DependencyGraphResult } from "../lib/api/graph-types";
import {
  transformEdges,
  transformNodes,
  type DependencyNode,
} from "../lib/graph/dependency-graph";
import { buildStructureGraph, computeLayers, computeModules, layerDAG, type ModuleInfo } from "../lib/graph/layout";

const COMPACT_NODE_WIDTH = 210;
const COMPACT_NODE_HEIGHT = 54;
const IMPORTANT_NODE_WIDTH = 240;
const IMPORTANT_NODE_HEIGHT = 62;

const NODE_LABELS = { file: "FILE", external: "EXTERNAL", unresolved: "UNRESOLVED" } as const;
type DependencyFlowNode = Node<Record<string, unknown>, "dependency">;

function DependencyNodeView({ data }: NodeProps<DependencyNode>) {
  const label = NODE_LABELS[data.node.node_type];
  const classification = typeof data.node.metadata.classification === "string" ? data.node.metadata.classification : null;
  const fileName = data.node.path_name.split("/").pop() ?? data.node.path_name;
  const directory = data.node.path_name.includes("/") ? `${data.node.path_name.slice(0, data.node.path_name.length - fileName.length)}…` : null;
  const important = data.weight === 3;
  return (
    <div
      className={`dependency-node node-${data.node.node_type}${data.cycle ? " is-cycle" : ""}${important ? " is-important" : ""}${!data.focused ? " is-dimmed" : ""}`}
      title={data.node.path_name}
    >
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="dependency-node-kicker">
        <span>{label}</span>
        {data.cycle ? <span className="dependency-node-cycleflag">CYCLE</span> : null}
      </div>
      <code className="dependency-node-name">{fileName}</code>
      <div className="dependency-node-meta">
        <span>{directory ?? data.node.language ?? classification ?? "dependency"}</span>
        {data.metrics ? <span>#{data.metrics.rank}</span> : <span>—</span>}
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  );
}

const nodeTypes = { dependency: DependencyNodeView };

interface LayoutOptions {
  /** Layer spacing; larger for module view so group cards breathe. */
  ranksep: number;
  nodesep: number;
  width: (node: DependencyNode) => number;
  height: (node: DependencyNode) => number;
}

function layout(nodes: DependencyNode[], edges: Edge[], options: LayoutOptions): DependencyNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: options.ranksep, nodesep: options.nodesep, marginx: 30, marginy: 30 });
  nodes.forEach((node) => graph.setNode(node.id, { width: options.width(node), height: options.height(node) }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return nodes.map((node) => {
    const width = options.width(node);
    const height = options.height(node);
    const point = graph.node(node.id);
    return { ...node, position: { x: point.x - width / 2, y: point.y - height / 2 }, sourcePosition: Position.Right, targetPosition: Position.Left };
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
      void fitView({ padding: 0.15, duration: 200, maxZoom: 1.8 }).catch(() => undefined);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [signature, fitView]);
  return null;
}

export function DependencyGraphCanvas({ graph, cycleIds, focusedIds, onSelect }: { graph: DependencyGraphResult; cycleIds: Set<string>; focusedIds: Set<string> | null; onSelect: (id: string) => void }) {
  const flow = useMemo(() => {
    const importantIds = new Set(graph.importance_ranking.slice(0, Math.max(5, Math.ceil(graph.nodes.length * 0.2))));
    const edges = transformEdges(graph, cycleIds, focusedIds);
    const nodes = transformNodes(graph, cycleIds, focusedIds, importantIds);
    const laid = layout(nodes, edges, {
      ranksep: 120,
      nodesep: 22,
      width: (node) => (node.data.weight === 3 ? IMPORTANT_NODE_WIDTH : COMPACT_NODE_WIDTH),
      height: (node) => (node.data.weight === 3 ? IMPORTANT_NODE_HEIGHT : COMPACT_NODE_HEIGHT),
    });
    return { nodes: laid, edges };
  }, [graph, cycleIds, focusedIds]);
  const signature = useMemo(() => `${flow.nodes.map((node) => node.id).join("\n")}#${flow.edges.length}`, [flow]);

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
          onNodeClick={(_, node) => onSelect(node.id)}
        >
          <FitOnChange signature={signature} />
          <Background gap={24} size={1} color="#27272A" />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            nodeColor={(node: DependencyFlowNode) => nodeColorFor(node.id, graph)}
            nodeStrokeColor={() => "#27272A"}
            maskColor="rgba(9, 9, 11, 0.75)"
            style={{ background: "#0D0D10", border: "1px solid #27272A" }}
          />
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
