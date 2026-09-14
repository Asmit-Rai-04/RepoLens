"use client";

import { useMemo } from "react";
import { ReactFlow, Background, Controls, Handle, MiniMap, Position, type Edge, type Node, type NodeProps } from "@xyflow/react";
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

export function DependencyGraphCanvas({ graph, cycleIds, focusedIds, onSelect }: { graph: DependencyGraphResult; cycleIds: Set<string>; focusedIds: Set<string> | null; onSelect: (id: string) => void }) {
  const flow = useMemo(() => {
    const edges = transformEdges(graph, cycleIds, focusedIds);
    const nodes = layout(transformNodes(graph, cycleIds, focusedIds), edges);
    return { nodes, edges };
  }, [graph, cycleIds, focusedIds]);

  return (
    <div className="dependency-canvas" aria-label="Interactive file dependency graph">
      <ReactFlow nodes={flow.nodes} edges={flow.edges} nodeTypes={nodeTypes} fitView minZoom={0.25} maxZoom={1.8} nodesDraggable nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.id)}>
        <Background gap={24} size={1} color="#27272A" />
        <Controls position="bottom-left" />
        <MiniMap pannable zoomable nodeColor={(node: DependencyFlowNode) => nodeColorFor(node.id, graph)} />
      </ReactFlow>
    </div>
  );
}

function nodeColorFor(id: string, graph: DependencyGraphResult): string {
  const node = graph.nodes.find((item) => item.id === id);
  if (node?.node_type === "external") return "#52525B";
  if (node?.node_type === "unresolved") return "#F95738";
  return "#A1A1AA";
}
