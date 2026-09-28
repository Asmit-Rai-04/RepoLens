"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ApiError, getDependencyGraph } from "../../../../lib/api/client";
import type { DependencyGraphResult } from "../../../../lib/api/graph-types";
import { applyFilter, capGraph, focusMembers, searchNodes, type GraphFilter } from "../../../../lib/graph/dependency-graph";
import { computeModules, computeLayers } from "../../../../lib/graph/layout";
import { DependencyGraphCanvas, DependencyStructureCanvas } from "../../../../components/DependencyGraph";
import { BrandHeader } from "../../../../components/BrandHeader";
import { AnalysisNav } from "../../../../components/AnalysisNav";
import { analysisHref, fileHref } from "../../../../lib/routes";

const FILTERS: GraphFilter[] = ["ALL", "CYCLES", "UNRESOLVED", "EXTERNAL", "IMPORTANT"];
const FILE_VIEW_CAP = 60;

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
  const [view, setView] = useState<"structure" | "files">("structure");
  const [query, setQuery] = useState("");
  const [focusIds, setFocusIds] = useState<Set<string> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ESC exits the fullscreen workspace.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const deepLink = useMemo(() => ({ cycle: searchParams.get("cycle"), file: searchParams.get("file") }), [searchParams]);

  useEffect(() => {
    if (deepLink.cycle) {
      const members = deepLink.cycle.split(",").filter(Boolean);
      setFocusIds(new Set(members));
      setSelectedId(members[0] ?? null);
      setView("files");
    } else if (deepLink.file) {
      setFocusIds(null);
      setSelectedId(deepLink.file);
      setView("files");
    }
  }, [deepLink]);

  // Filters reduce the candidate set BEFORE any view-specific transform; both the module
  // projection and the file canvas derive from this, so a filter can never be ignored by
  // either view.
  const baseFiltered = useMemo(() => {
    if (!data) return null;
    let view = applyFilter(data, filter);
    if (focusIds) view = focusMembers(view, [...focusIds]);
    return view;
  }, [data, filter, focusIds]);

  const prepared = useMemo(() => {
    if (!baseFiltered) return null;
    // A deep-linked file is always kept so its node is visible in the canvas.
    return capGraph(baseFiltered, FILE_VIEW_CAP, deepLink.file ? [deepLink.file] : []);
  }, [baseFiltered, deepLink]);

  // Structure view: same filtered set (no file cap). Search narrows it to matching modules.
  const structureGraph = useMemo(() => {
    if (!baseFiltered) return null;
    if (!query.trim()) return baseFiltered;
    const keep = searchNodes(baseFiltered, query);
    return {
      ...baseFiltered,
      nodes: baseFiltered.nodes.filter((node) => keep.has(node.id)),
      edges: baseFiltered.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target)),
    };
  }, [baseFiltered, query]);

  const cycleIds = useMemo(() => new Set(data?.cycles.flatMap((cycle) => cycle.files) ?? []), [data]);
  const focusNeighborhood = useMemo(() => {
    if (!data) return null;
    // Search dims the graph toward matches; selection dims toward the node's neighbourhood.
    if (query.trim()) return searchNodes(data, query);
    if (!selectedId) return null;
    const members = new Set<string>([selectedId]);
    for (const edge of data.edges) {
      if (edge.source === selectedId) members.add(edge.target);
      if (edge.target === selectedId) members.add(edge.source);
    }
    return members;
  }, [data, selectedId, query]);

  const selected = data?.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedMetrics = selected ? data?.metrics.node_metrics[selected.id] ?? null : null;

  const openFullscreen = useCallback(() => { setExpanded(true); setSidebarOpen(false); }, []);
  const closeFullscreen = useCallback(() => setExpanded(false), []);

  if (loading) return <main className="centered"><div className="loading-block" role="status" aria-live="polite"><div className="spinner" aria-hidden="true" /><p>Loading dependency graph…</p></div></main>;
  if (error || !data) return <main className="centered"><div className="error-block"><div className="page-kicker">Dependency graph</div><h1>Graph unavailable.</h1><p>{error ?? "The backend did not return graph data."}</p><Link href={analysisHref(id, "/overview")} className="primary-button">Return to overview</Link></div></main>;
  if (!prepared || !structureGraph) return null;

  const filteredGraph = { ...data, nodes: prepared.nodes, edges: prepared.edges, metrics: { node_metrics: prepared.metrics } };
  const filterEmpty = filter !== "ALL" && (view === "files" ? prepared.nodes.length === 0 : structureGraph.nodes.length === 0);
  const emptyLabel =
    filter === "CYCLES" ? "NO CYCLES DETECTED" :
    filter === "UNRESOLVED" ? "NO UNRESOLVED DEPENDENCIES" :
    filter === "EXTERNAL" ? "NO EXTERNAL DEPENDENCIES" :
    filter === "IMPORTANT" ? "NO IMPORTANT NODES RANKED" : "";

  return (
    <main className={`overview-page dependency-page${expanded ? " graph-fullscreen-active" : ""}`}>
      <div className="container dependency-shell">
      <div className={`graph-workspace${expanded ? " graph-workspace--expanded" : ""}`}>
        {expanded ? (
          <div className="graph-fullstrip">
            <BrandHeader />
            <div className="graph-fullstrip-actions">
              <button className="secondary-button compact-button" type="button" aria-label={sidebarOpen ? "Close analysis panel" : "Open analysis panel"} onClick={() => setSidebarOpen((open) => !open)}>
                {sidebarOpen ? "HIDE PANEL" : "SHOW PANEL"}
              </button>
              <button type="button" className="text-link graph-expand" aria-label="Exit fullscreen" onClick={closeFullscreen}>
                EXIT FULLSCREEN
              </button>
            </div>
          </div>
        ) : (
          <header className="page-header dependency-header">
            <div>
              <div className="page-kicker"><span className="kicker-accent">DEPENDENCY</span> / GRAPH</div>
              <h1>How files depend on each other.</h1>
            </div>
            <div className="page-actions">
              <Link href={analysisHref(id, "/overview")} className="text-link">Overview</Link>
              <Link href={analysisHref(id, "/files")} className="text-link">Files</Link>
              <button type="button" className="text-link graph-expand" aria-label="Expand graph" onClick={openFullscreen}>
                EXPAND GRAPH
              </button>
            </div>
          </header>
        )}

        {expanded ? null : <AnalysisNav />}

        <section className="dependency-toolbar" aria-label="Dependency graph controls">
          <div className="filter-tabs" role="tablist" aria-label="Dependency graph filters">
            {FILTERS.map((item) => <button key={item} type="button" role="tab" aria-selected={filter === item} className={`filter-tab${filter === item ? " active" : ""}`} onClick={() => { setFilter(item); setFocusIds(null); }}>{item}</button>)}
          </div>
          <div className="filter-tabs" role="tablist" aria-label="Graph presentation level">
            <button type="button" role="tab" aria-selected={view === "structure"} className={`filter-tab${view === "structure" ? " active" : ""}`} onClick={() => setView("structure")}>STRUCTURE</button>
            <button type="button" role="tab" aria-selected={view === "files"} className={`filter-tab${view === "files" ? " active" : ""}`} onClick={() => setView("files")}>FILES</button>
          </div>
          <label className="graph-search"><span>Search file path</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="src/services/user.ts" /></label>
          {focusIds ? <button className="secondary-button compact-button" type="button" onClick={() => setFocusIds(null)}>Clear focus</button> : null}
        </section>

        <div className="dependency-workbench">
          <section className="dependency-canvas-panel" aria-label="Dependency graph visualization">
            <div className="graph-readout" role="status">
              {view === "structure"
                ? <span>STRUCTURE VIEW · {structureGraph.nodes.filter((node) => node.node_type === "file").length} FILES IN {moduleCount(structureGraph)} MODULES{filter !== "ALL" ? ` · FILTER ${filter}` : ""}</span>
                : <span>{prepared.truncated ? `SHOWING ${prepared.nodes.length} OF ${prepared.totalNodeCount} NODES · CAPPED BY IMPORTANCE` : `${prepared.nodes.length} NODES`} · IMPORTANT CONNECTIONS EMPHASIZED</span>}
              {cycleIds.size > 0 ? <span className="graph-readout-accent">{data.cycles.length} CYCLE{data.cycles.length === 1 ? "" : "S"}</span> : null}
            </div>
            <div className="graph-legend" aria-label="Graph legend">
              <span><i className="legend-node" /> FILE</span>
              <span><i className="legend-node legend-node-muted" /> EXTERNAL</span>
              <span><i className="legend-line" /> DEPENDENCY</span>
              <span><i className="legend-line legend-line-accent" /> CYCLE / IMPORTANT</span>
              <span><i className="legend-line legend-line-dashed" /> UNRESOLVED</span>
            </div>
            {view === "structure"
              ? <DependencyStructureCanvas key={expanded ? "structure-x" : "structure"} graph={structureGraph} cycleIds={cycleIds} onSelect={(key) => { setView("files"); setFilter("ALL"); setQuery(key.startsWith("::dir:") ? key.slice("::dir:".length) : ""); }} />
              : <DependencyGraphCanvas key={expanded ? "files-x" : "files"} graph={filteredGraph} cycleIds={cycleIds} focusedIds={focusNeighborhood} onSelect={setSelectedId} />}
            {filterEmpty ? <div className="graph-empty-state" role="status"><span>{emptyLabel}</span></div> : null}
          </section>

          <aside className={`dependency-sidebar${expanded && sidebarOpen ? " graph-overlay-open" : ""}`} aria-label="Dependency graph analysis">
            <section className="graph-panel-block">
              <div className="section-kicker">{selected?.node_type === "external" ? "External package" : selected?.node_type === "unresolved" ? "Unresolved import" : "Selected file"}</div>
              <h2>{selected ? selected.path_name : "Select a node"}</h2>
              {selected ? <>
                <div className="node-type-badge">{selected.node_type}</div>
                {selected.language ? <p className="selected-meta">LANGUAGE · {selected.language}</p> : null}
                {selectedMetrics ? <div className="metric-grid compact-metrics"><Metric label="Incoming" value={selectedMetrics.incoming_dependencies} /><Metric label="Outgoing" value={selectedMetrics.outgoing_dependencies} /><Metric label="Centrality" value={selectedMetrics.betweenness_centrality.toFixed(3)} /><Metric label="Importance" value={selectedMetrics.importance.toFixed(2)} /><Metric label="Rank" value={`#${selectedMetrics.rank}`} /></div> : null}
                {selected.node_type === "external" ? <p className="inspector-note">Backend-resolved external package. Its edges show which internal files depend on it.</p> : null}
                {selected.node_type === "unresolved" ? <p className="inspector-note">Import the analyzer could not resolve to a file inside the repository.</p> : null}
                {selected.node_type === "file" ? <Link href={fileHref(id, selected.path_name)} className="primary-button full-button">Open File Inspector</Link> : null}
              </> : <p className="inspector-empty">Choose a file, external package, or unresolved dependency to inspect its backend-provided metadata.</p>}
            </section>

            <section className="graph-panel-block">
              <div className="section-heading-row"><div><div className="section-kicker">Cycles</div><h2>Detected cycles</h2></div><span className="technical-count">{data.cycles.length}</span></div>
              {data.cycles_truncated ? <p className="inspector-note" role="status">A strongly connected component contains more cycles than can be listed, so the shortest cycles are shown.</p> : null}
              <div className="focus-list">{data.cycles.length === 0 ? <div className="inspector-empty">NO IMPORT CYCLES DETECTED</div> : data.cycles.map((cycle, index) => <button type="button" className="focus-row" key={`${cycle.files.join("::")}-${index}`} onClick={() => { setView("files"); setFilter("CYCLES"); setFocusIds(new Set(cycle.files)); setSelectedId(cycle.files[0] ?? null); }}><span><strong>Cycle {index + 1}</strong><small>{cycle.length} files</small></span><code>{cycle.files.join(" → ")}</code></button>)}</div>
            </section>

            <section className="graph-panel-block">
              <div className="section-heading-row"><div><div className="section-kicker">SCCs</div><h2>Strong components</h2></div><span className="technical-count">{data.strongly_connected_components.length}</span></div>
              <div className="focus-list">{data.strongly_connected_components.length === 0 ? <div className="inspector-empty">NO MULTI-FILE SCCS DETECTED</div> : data.strongly_connected_components.map((members, index) => <button type="button" className="focus-row" key={`${members.join("::")}-${index}`} onClick={() => { setView("files"); setFilter("ALL"); setFocusIds(new Set(members)); setSelectedId(members[0] ?? null); }}><span><strong>SCC {index + 1}</strong><small>{members.length} files</small></span><code>{members.join(" · ")}</code></button>)}</div>
            </section>

            <section className="graph-panel-block">
              <div className="section-heading-row"><div><div className="section-kicker">Importance</div><h2>Backend ranking</h2></div><span className="technical-count">{data.importance_ranking.length}</span></div>
              <div className="importance-list">{data.importance_ranking.slice(0, 20).map((path, index) => { const metric = data.metrics.node_metrics[path]; return <button type="button" className="importance-row" key={path} onClick={() => { setView("files"); setSelectedId(path); }}><span className="rank-number">{index + 1}</span><code>{path}</code><span>{metric?.importance.toFixed(2) ?? "—"}</span></button>; })}</div>
            </section>
          </aside>
        </div>
      </div>
      </div>
    </main>
  );
}

/** Same grouping the structure canvas uses, so the readout never contradicts the graph. */
function moduleCount(graph: DependencyGraphResult): number {
  return computeModules(graph, computeLayers(graph).layers).length;
}

function Metric({ label, value }: { label: string; value: number | string }) { return <div><span>{label}</span><strong>{value}</strong></div>; }
