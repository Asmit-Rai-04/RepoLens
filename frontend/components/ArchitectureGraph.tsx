"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import  {
  ReactFlow,
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import "@xyflow/react/dist/style.css";
import type { ArchitectureResponse, LayerInfo } from "../lib/api/architecture-types";
import { fileHref } from "../lib/routes";

const NODE_WIDTH = 236;
const NODE_HEIGHT = 118;

type LayerNodeData = {
  layer: LayerInfo;
  violationCount: number;
  fileCount: number;
};

type LayerNode = Node<LayerNodeData, "layer">;

function LayerNodeView({ data }: NodeProps<LayerNode>) {
  return (
    <div className={`architecture-node${data.violationCount > 0 ? " is-violated" : ""}`}>
      <Handle type="target" position={Position.Left} className="flow-handle" />
      <div className="architecture-node-kicker">LAYER</div>
      <div className="architecture-node-name">{data.layer.name}</div>
      <div className="architecture-node-meta">
        <span>{data.fileCount} files</span>
        <span>{data.violationCount} violations</span>
      </div>
      <Handle type="source" position={Position.Right} className="flow-handle" />
    </div>
  );
}

const nodeTypes = { layer: LayerNodeView };

function layoutGraph(nodes: LayerNode[], edges: Edge[]): LayerNode[] {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "LR", ranksep: 96, nodesep: 44, marginx: 40, marginy: 40 });
  nodes.forEach((node) => graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
  edges.forEach((edge) => graph.setEdge(edge.source, edge.target));
  dagre.layout(graph);

  return nodes.map((node) => {
    const point = graph.node(node.id);
    return {
      ...node,
      position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };
  });
}

function buildGraph(data: ArchitectureResponse): { nodes: LayerNode[]; edges: Edge[] } {
  const layers = data.report.primary.layers;
  const violationPairs = new Set(
    data.report.primary.violations.map((violation) => `${violation.source_layer}::${violation.target_layer}`),
  );
  const violationCounts = new Map<string, number>();
  data.report.primary.violations.forEach((violation) => {
    violationCounts.set(violation.source_layer, (violationCounts.get(violation.source_layer) ?? 0) + 1);
    violationCounts.set(violation.target_layer, (violationCounts.get(violation.target_layer) ?? 0) + 1);
  });

  const nodes: LayerNode[] = layers.map((layer) => ({
    id: layer.name,
    type: "layer",
    position: { x: 0, y: 0 },
    data: {
      layer,
      fileCount: layer.paths.length,
      violationCount: violationCounts.get(layer.name) ?? 0,
    },
  }));

  const edges: Edge[] = data.layer_edges.map((edge, index) => {
    const isViolation = edge.violation || violationPairs.has(`${edge.source_layer}::${edge.target_layer}`);
    return {
      id: `layer-edge-${index}-${edge.source_layer}-${edge.target_layer}`,
      source: edge.source_layer,
      target: edge.target_layer,
      label: `${edge.import_count} ${edge.import_count === 1 ? "import" : "imports"}`,
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      className: isViolation ? "architecture-edge violation-edge" : "architecture-edge",
      animated: false,
      style: isViolation ? undefined : { strokeWidth: 1.5 },
    };
  });

  return { nodes: layoutGraph(nodes, edges), edges };
}

export function ArchitectureGraph({ data, analysisId }: { data: ArchitectureResponse; analysisId: string }) {
  const graph = useMemo(() => buildGraph(data), [data]);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const selected = graph.nodes.find((node) => node.id === selectedLayer)?.data.layer ?? null;
  const selectedViolations = selected
    ? data.report.primary.violations.filter((violation) => violation.source_layer === selected.name || violation.target_layer === selected.name)
    : [];
  const incoming = selected ? data.layer_edges.filter((edge) => edge.target_layer === selected.name) : [];
  const outgoing = selected ? data.layer_edges.filter((edge) => edge.source_layer === selected.name) : [];

  return (
    <div className="architecture-layout">
      <section className="architecture-canvas-panel" aria-label="Architecture dependency graph">
        <div className="architecture-canvas-header">
          <div>
            <div className="section-kicker">Architecture map</div>
            <h2>Layer dependency flow</h2>
          </div>
          <div className="architecture-legend">
            <span><i className="legend-line" /> dependency</span>
            <span><i className="legend-line legend-line-violation" /> violation</span>
          </div>
        </div>
        {graph.nodes.length === 0 ? (
          <div className="architecture-empty" role="status">
            <p>No meaningful architecture layers were detected.</p>
            <span>RepoLens will keep the evidence available without forcing a graph.</span>
          </div>
        ) : (
          <div className="architecture-canvas">
            <ReactFlow
              nodes={graph.nodes}
              edges={graph.edges}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.2, minZoom: 0.55, maxZoom: 1.25 }}
              minZoom={0.35}
              maxZoom={1.8}
              onNodeClick={(_, node) => setSelectedLayer(node.id)}
              nodesDraggable
              nodesConnectable={false}
              elementsSelectable
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={24} size={1} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeColor={(node) => (node.data?.violationCount ? "#F95738" : "#A1A1AA")} />
            </ReactFlow>
          </div>
        )}
      </section>

      <aside className="layer-inspector" aria-labelledby="layer-inspector-heading">
        <div className="section-kicker">Inspector</div>
        <h2 id="layer-inspector-heading">Layer details</h2>
        {selected ? (
          <>
            <div className="inspector-title">{selected.name}</div>
            <div className="inspector-stat-row">
              <span>Files</span><strong>{selected.paths.length}</strong>
            </div>
            <div className="inspector-block">
              <div className="inspector-label">Expected dependencies</div>
              <div className="inspector-tags">
                {selected.expected_dependencies.length ? selected.expected_dependencies.map((name) => <span key={name}>{name}</span>) : <em>None declared</em>}
              </div>
            </div>
            <div className="inspector-block">
              <div className="inspector-label">Forbidden dependencies</div>
              <div className="inspector-tags">
                {selected.forbidden_dependencies.length ? selected.forbidden_dependencies.map((name) => <span key={name} className="danger-tag">{name}</span>) : <em>None declared</em>}
              </div>
            </div>
            <div className="inspector-block">
              <div className="inspector-label">Observed dependencies</div>
              <div className="inspector-tags">
                {selected.observed_dependencies.length ? selected.observed_dependencies.map((name) => <span key={name}>{name}</span>) : <em>None observed</em>}
              </div>
            </div>
            <div className="inspector-block">
              <div className="inspector-label">Incoming</div>
              {incoming.length ? incoming.map((edge) => <div className="inspector-row" key={`${edge.source_layer}-${edge.target_layer}`}><span>{edge.source_layer}</span><strong>{edge.import_count}</strong></div>) : <em>None observed</em>}
            </div>
            <div className="inspector-block">
              <div className="inspector-label">Outgoing</div>
              {outgoing.length ? outgoing.map((edge) => <div className="inspector-row" key={`${edge.source_layer}-${edge.target_layer}`}><span>{edge.target_layer}</span><strong>{edge.import_count}</strong></div>) : <em>None observed</em>}
            </div>
            <div className="inspector-block">
              <div className="inspector-label">Evidence</div>
              {data.report.primary.evidence.filter((evidence) => evidence.supporting_paths.some((path) => selected.paths.includes(path))).length ? (
                data.report.primary.evidence
                  .filter((evidence) => evidence.supporting_paths.some((path) => selected.paths.includes(path)))
                  .map((evidence) => (
                    <div className="inspector-evidence" key={`${evidence.type}-${evidence.description}`}>
                      <strong>{evidence.type}</strong>
                      <p>{evidence.description}</p>
                    </div>
                  ))
              ) : (
                <em>No layer-specific evidence reported.</em>
              )}
            </div>
            <div className="inspector-block">
              <div className="inspector-label">Violations</div>
              {selectedViolations.length ? selectedViolations.map((violation) => (
                <div className="inspector-violation" key={`${violation.kind}-${violation.source}-${violation.target}`}>
                  <strong>{violation.kind}</strong>
                  <p>{violation.description}</p>
                </div>
              )) : <div className="all-clear">No violations observed.</div>}
            </div>
            <div className="inspector-block">
              <div className="inspector-label">Files</div>
              <div className="file-list">{selected.paths.map((path) => (
                <Link key={path} href={fileHref(analysisId, path)} className="file-link"><code>{path}</code></Link>
              ))}</div>
            </div>
          </>
        ) : (
          <div className="inspector-empty">
            <p>Select a layer to inspect its dependencies and evidence.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
