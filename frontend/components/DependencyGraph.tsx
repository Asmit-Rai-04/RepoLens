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

const NODE_WIDTH = 245;
const NODE_HEIGHT = 92;

const NODE_LABELS = { file: "FILE", external: "EXTERNAL", unresolved: "UNRESOLVED" } as const;

type DependencyFlowNode = Node<Record<string, unknown>, "dependency">;

function DependencyNodeView({ data }: NodeProps<DependencyNode>) {
  const label = NODE_LABELS[data.node.node_type];
  const classification = typeof data.node.metadata.classification === "string" ? data.node.metadata.classification : null;
  return (
    <div className={`dependency-node node-${data.node.node_type}${data.cycle ? " is-cycle" : ""}${!data.focused ? " is-dimmed" : ""}`} title={data.node.path_name}>
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="dependency-node-kicker">{label}</div>
      <code className="dependency-node-name">{data.node.path_name}</code>
      <div className="dependency-node-meta">
        <span>{data.node.language ?? classification ?? "dependency"}</span>
        {data.metrics ? <span>#{data.metrics.rank}</span> : <span>—</span>}
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  );
}

const nodeTypes = { dependency: DependencyNodeView };

function layout(nodes: DependencyNode[], edges: Edge[]): DependencyNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: 80, nodesep: 36, marginx: 30, marginy: 30 });
  nodes.forEach((node) => graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);
  return nodes.map((node) => {
    const point = graph.node(node.id);
    return { ...node, position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 }, sourcePosition: Position.Right, targetPosition: Position.Left };
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
    const edges = transformEdges(graph, cycleIds, focusedIds);
    const nodes = layout(transformNodes(graph, cycleIds, focusedIds), edges);
    return { nodes, edges };
  }, [graph, cycleIds, focusedIds]);
  const signature = useMemo(() => `${flow.nodes.map((node) => node.id).join("\n")}#${flow.edges.length}`, [flow]);

  return (
    <div className="dependency-canvas" aria-label="Interactive file dependency graph">
      <ReactFlowProvider>
        <ReactFlow nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} fitView minZoom={0.25} maxZoom={1.8} nodesDraggable nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.id)}>
          <FitOnChange signature={signature} />
          <Background gap={24} size={1} color="#27272A" />
          <Controls position="bottom-left" />
          <MiniMap pannable zoomable nodeColor={(node: DependencyFlowNode) => nodeColorFor(node.id, graph)} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

function nodeColorFor(id: string, graph: DependencyGraphResult): string {
  const node = graph.nodes.find((item) => item.id === id);
  if (node?.node_type === "external") return "#52525B";
  if (node?.node_type === "unresolved") return "#F95738";
  return "#A1A1AA";
}
