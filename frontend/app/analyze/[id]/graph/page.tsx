"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ApiError, getDependencyGraph } from "../../../../lib/api/client";
import type { DependencyGraphResult } from "../../../../lib/api/graph-types";
import { applyFilter, capGraph, focusMembers, searchNodes, type GraphFilter } from "../../../../lib/graph/dependency-graph";
import { DependencyGraphCanvas } from "../../../../components/DependencyGraph";
import { analysisHref, fileHref } from "../../../../lib/routes";

const FILTERS: GraphFilter[] = ["ALL", "CYCLES", "UNRESOLVED", "EXTERNAL", "IMPORTANT"];

function useGraph(analysisId: string) {
  const [data, setData] = useState<DependencyGraphResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getDependencyGraph(analysisId)
      .then((result) => { if (active) { setData(result); setLoading(false); } })
      .catch((caught: unknown) => { if (active) { setError(caught instanceof ApiError ? caught.message : "Unable to load the dependency graph."); setLoading(false); } });
    return () => { active = false; };
  }, [analysisId]);
  return { data, error, loading };
}

export default function DependencyGraphPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = params.id;
  const { data, error, loading } = useGraph(id);
  const [filter, setFilter] = useState<GraphFilter>("ALL");
  const [query, setQuery] = useState("");
  const [focusIds, setFocusIds] = useState<Set<string> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const deepLink = useMemo(() => ({ cycle: searchParams.get("cycle"), file: searchParams.get("file") }), [searchParams]);

  useEffect(() => {
    if (deepLink.cycle) {
      const members = deepLink.cycle.split(",").filter(Boolean);
      setFocusIds(new Set(members));
      setSelectedId(members[0] ?? null);
    } else if (deepLink.file) {
      setFocusIds(null);
      setSelectedId(deepLink.file);
    }
  }, [deepLink]);

  const prepared = useMemo(() => {
    if (!data) return null;
    let view = applyFilter(data, filter);
    if (query.trim()) {
      const matches = searchNodes(view, query);
      view = {
        ...view,
        nodes: view.nodes.filter((node) => matches.has(node.id)),
        edges: view.edges.filter((edge) => matches.has(edge.source) && matches.has(edge.target)),
        metrics: {
          node_metrics: Object.fromEntries(
            view.nodes
              .filter((node) => matches.has(node.id) && view.metrics.node_metrics[node.id])
              .map((node) => [node.id, view.metrics.node_metrics[node.id]]),
          ),
        },
      };
    }
    if (focusIds) view = focusMembers(view, [...focusIds]);
    // A deep-linked file is always kept so its node is visible in the canvas.
    return capGraph(view, 60, deepLink.file ? [deepLink.file] : []);
  }, [data, filter, query, focusIds, deepLink]);

  const cycleIds = useMemo(() => new Set(data?.cycles.flatMap((cycle) => cycle.files) ?? []), [data]);
  const selected = data?.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedMetrics = selected ? data?.metrics.node_metrics[selected.id] ?? null : null;
  const selectedRank = selected ? (data?.importance_ranking.indexOf(selected.id) ?? -1) + 1 : 0;

  if (loading) return <main className="centered"><div className="loading-block" role="status" aria-live="polite"><div className="spinner" aria-hidden="true" /><p>Loading dependency graph…</p></div></main>;
  if (error || !data) return <main className="centered"><div className="error-block"><div className="page-kicker">Dependency graph</div><h1>Graph unavailable.</h1><p>{error ?? "The backend did not return graph data."}</p><Link href={analysisHref(id, "/overview")} className="primary-button">Return to overview</Link></div></main>;
  if (!prepared) return null;

  return (
    <main className="overview-page dependency-page">
      <div className="container dependency-shell">
        <header className="page-header dependency-header">
          <div>
            <div className="page-kicker">Dependency graph</div>
            <h1>How files depend on each other.</h1>
            <p className="page-lede">Backend-computed imports, inheritance, cycles, SCCs, and importance. The frontend only filters, focuses, and visualizes.</p>
          </div>
          <div className="page-actions"><Link href={analysisHref(id, "/overview")} className="text-link">Overview</Link><Link href={analysisHref(id, "/files")} className="text-link">Files</Link></div>
        </header>

        <section className="dependency-toolbar" aria-label="Dependency graph controls">
          <div className="filter-tabs" role="tablist" aria-label="Dependency graph filters">
            {FILTERS.map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} className={`filter-tab${filter === item ? " active" : ""}`} onClick={() => { setFilter(item); setFocusIds(null); }}>{item}</button>)}
          </div>
          <label className="graph-search"><span>Search file path</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="src/services/user.ts" /></label>
          {focusIds ? <button className="secondary-button compact-button" type="button" onClick={() => setFocusIds(null)}>Clear focus</button> : null}
        </section>

        <div className="dependency-workbench">
          <section className="dependency-canvas-panel" aria-label="Dependency graph visualization">
            {prepared.truncated ? <div className="graph-cap-banner" role="status">Showing {prepared.nodes.length} of {prepared.totalNodeCount} nodes · capped to the most important connected files.</div> : null}
            <DependencyGraphCanvas graph={{ ...data, nodes: prepared.nodes, edges: prepared.edges, metrics: { node_metrics: prepared.metrics } }} cycleIds={cycleIds} focusedIds={focusIds} onSelect={setSelectedId} />
          </section>

          <aside className="dependency-sidebar" aria-label="Dependency graph analysis">
            <section className="graph-panel-block">
              <div className="section-kicker">Selected file</div>
              <h2>{selected ? selected.path_name : "Select a node"}</h2>
              {selected ? <>
                <div className="node-type-badge">{selected.node_type}</div>
                {selectedMetrics ? <div className="metric-grid compact-metrics"><Metric label="Incoming" value={selectedMetrics.incoming_dependencies} /><Metric label="Outgoing" value={selectedMetrics.outgoing_dependencies} /><Metric label="Centrality" value={selectedMetrics.betweenness_centrality.toFixed(3)} /><Metric label="Importance" value={selectedMetrics.importance.toFixed(2)} /><Metric label="Rank" value={`#${selectedMetrics.rank}`} /></div> : null}
                {selected.node_type === "file" ? <Link href={fileHref(id, selected.path_name)} className="primary-button full-button">Open File Inspector</Link> : null}
              </> : <p className="inspector-empty">Choose a file, external package, or unresolved dependency to inspect its backend-provided metadata.</p>}
            </section>

            <section className="graph-panel-block">
              <div className="section-heading-row"><div><div className="section-kicker">Cycles</div><h2>Detected cycles</h2></div><span className="technical-count">{data.cycles.length}</span></div>
              {data.cycles_truncated ? <p className="inspector-note" role="status">A strongly connected component contains more cycles than can be listed, so the shortest cycles are shown.</p> : null}
              <div className="focus-list">{data.cycles.length === 0 ? <div className="inspector-empty">No import cycles detected.</div> : data.cycles.map((cycle, index) => <button type="button" className="focus-row" key={`${cycle.files.join("::")}-${index}`} onClick={() => { setFocusIds(new Set(cycle.files)); setSelectedId(cycle.files[0] ?? null); }}><span><strong>Cycle {index + 1}</strong><small>{cycle.length} files</small></span><code>{cycle.files.join(" → ")}</code></button>)}</div>
            </section>

            <section className="graph-panel-block">
              <div className="section-heading-row"><div><div className="section-kicker">SCCs</div><h2>Strong components</h2></div><span className="technical-count">{data.strongly_connected_components.length}</span></div>
              <div className="focus-list">{data.strongly_connected_components.length === 0 ? <div className="inspector-empty">No multi-file SCCs detected.</div> : data.strongly_connected_components.map((members, index) => <button type="button" className="focus-row" key={`${members.join("::")}-${index}`} onClick={() => { setFocusIds(new Set(members)); setSelectedId(members[0] ?? null); }}><span><strong>SCC {index + 1}</strong><small>{members.length} files</small></span><code>{members.join(" · ")}</code></button>)}</div>
            </section>

            <section className="graph-panel-block">
              <div className="section-heading-row"><div><div className="section-kicker">Importance</div><h2>Backend ranking</h2></div><span className="technical-count">{data.importance_ranking.length}</span></div>
              <div className="importance-list">{data.importance_ranking.slice(0, 20).map((path, index) => { const metric = data.metrics.node_metrics[path]; return <button type="button" className="importance-row" key={path} onClick={() => setSelectedId(path)}><span className="rank-number">{index + 1}</span><code>{path}</code><span>{metric?.importance.toFixed(2) ?? "—"}</span></button>; })}</div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
