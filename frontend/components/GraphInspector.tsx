"use client";
import Link from "next/link";
import type { DependencyGraphResult } from "../lib/api/graph-types";
import {
  dependencyPath,
  type GraphIndex,
  type EntityKind,
  type Visit,
  type WorkspaceState,
} from "../lib/graph/workbench";
import { fileHref } from "../lib/routes";

export function GraphInspector({
  graph,
  index,
  state,
  visits,
  analysisId,
  update,
  choose,
}: {
  graph: DependencyGraphResult;
  index: GraphIndex;
  state: WorkspaceState;
  visits: Map<string, Visit>;
  analysisId?: string;
  update: (change: Partial<WorkspaceState>) => void;
  choose: (id: string, kind?: EntityKind) => void;
}) {
  const selected = state.file ? index.nodes.get(state.file) : null;
  const outgoing = selected ? (index.outgoing.get(selected.id) ?? []) : [];
  const incoming = selected ? (index.incoming.get(selected.id) ?? []) : [];
  const metric = selected ? graph.metrics.node_metrics[selected.id] : null;
  const dependencyCount = new Set(outgoing.map((edge) => edge.target)).size;
  const dependentCount = new Set(incoming.map((edge) => edge.source)).size;
  const affected = [...visits].filter(([, visit]) => visit.depth > 0);
  return (
    <>
      <section className="graph-panel-block">
        <div className="section-kicker">
          Inspector · {selected?.node_type ?? "selection"}
        </div>
        <h2>{selected?.path_name ?? "Select a file"}</h2>
        {selected ? (
          <>
            <p>{selected.language ?? "Dependency entity"}</p>
            <dl className="workbench-metrics">
              <div>
                <dt>Dependencies</dt>
                <dd>{dependencyCount}</dd>
              </div>
              <div>
                <dt>Dependents</dt>
                <dd>{dependentCount}</dd>
              </div>
              {metric ? (
                <>
                  <div>
                    <dt>Importance</dt>
                    <dd>{metric.importance.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>Rank</dt>
                    <dd>#{metric.rank}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            {analysisId && selected.node_type === "file" ? (
              <Link
                className="primary-button full-button"
                href={fileHref(analysisId, selected.path_name)}
              >
                Open File Inspector
              </Link>
            ) : null}
            {selected.node_type === "file" ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    update({
                      mode: "impact",
                      direction: "dependents",
                      depth: Infinity,
                      cycle: null,
                      level: "files",
                      module: null,
                      filter: "ALL",
                    })
                  }
                >
                  Explore change impact
                </button>
                {analysisId ? (
                  <Link
                    className="text-link"
                    href={fileHref(analysisId, selected.path_name)}
                  >
                    Inspect source symbols →
                  </Link>
                ) : (
                  <p>
                    Demo symbols:{" "}
                    {Array.isArray(selected.metadata.symbols)
                      ? selected.metadata.symbols.join(", ")
                      : "none"}
                  </p>
                )}
              </>
            ) : null}
            <h3>Dependency spotlight</h3>
            <label>
              Direction
              <select
                aria-label="Direction"
                value={state.direction}
                onChange={(event) =>
                  update({
                    direction: event.target
                      .value as WorkspaceState["direction"],
                    mode: "focus",
                    cycle: null,
                  })
                }
              >
                <option value="dependencies">Dependencies →</option>
                <option value="dependents">← Dependents</option>
                <option value="both">Both directions</option>
              </select>
            </label>
            <label>
              Dependency depth
              <select
                aria-label="Dependency depth"
                value={state.depth === Infinity ? "all" : state.depth}
                onChange={(event) =>
                  update({
                    depth:
                      event.target.value === "all"
                        ? Infinity
                        : Number(event.target.value),
                  })
                }
              >
                <option value="1">Direct only</option>
                <option value="2">Up to depth 2</option>
                <option value="all">All reachable</option>
              </select>
            </label>
            <button
              type="button"
              onClick={() =>
                update({
                  mode: "focus",
                  cycle: null,
                  level: "files",
                  module: null,
                  filter: "ALL",
                })
              }
            >
              Focus selection
            </button>
            <button
              type="button"
              onClick={() => update({ mode: "normal", cycle: null })}
            >
              Clear focus
            </button>
            <h3>Dependencies → ({dependencyCount})</h3>
            <ul className="relationship-list">
              {outgoing.map((edge, i) => (
                <li key={`${edge.target}-${i}`}>
                  <button type="button" onClick={() => choose(edge.target)}>
                    {index.nodes.get(edge.target)?.path_name ?? edge.target}
                  </button>
                  <small>
                    {edge.edge_type} ·{" "}
                    {Object.entries(edge.import_evidence)
                      .filter(
                        ([, value]) =>
                          typeof value === "string" ||
                          typeof value === "number",
                      )
                      .map(([key, value]) => `${key}: ${value}`)
                      .join(" · ") || "No additional source evidence"}
                  </small>
                </li>
              ))}
            </ul>
            <h3>← Dependents ({dependentCount})</h3>
            <ul className="relationship-list">
              {incoming.map((edge, i) => (
                <li key={`${edge.source}-${i}`}>
                  <button type="button" onClick={() => choose(edge.source)}>
                    {index.nodes.get(edge.source)?.path_name ?? edge.source}
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            Choose a node or use the searchable explorer. Arrows point from
            importing file to imported dependency.
          </p>
        )}
      </section>
      {state.mode === "impact" ? (
        <section className="graph-panel-block">
          <h2>Potentially affected ({affected.length})</h2>
          <p>
            Structural dependency analysis indicates possible impact, not
            guaranteed runtime breakage. Direct dependents import this file;
            transitive dependents reach it through other files.
          </p>
          <ul className="relationship-list">
            {affected.slice(0, 100).map(([id, visit]) => (
              <li key={id}>
                <button type="button" onClick={() => choose(id)}>
                  {index.nodes.get(id)?.path_name}
                </button>
                <small>
                  {visit.depth === 1
                    ? "Direct dependent"
                    : "Transitive dependent"}{" "}
                  · dependency distance {visit.depth}
                </small>
                <code>
                  {dependencyPath(visits, id)
                    .map((key) => index.nodes.get(key)?.path_name)
                    .join(" → ")}
                </code>
                {analysisId && index.nodes.get(id)?.node_type === "file" ? (
                  <Link
                    href={fileHref(analysisId, index.nodes.get(id)!.path_name)}
                  >
                    Open source
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
          {affected.length > 100 ? (
            <p>
              First 100 paths shown. All affected files remain available in the
              paginated graph explorer.
            </p>
          ) : null}
        </section>
      ) : null}
      <section className="graph-panel-block">
        <h2>Detected cycles ({graph.cycles.length})</h2>
        <p>
          {graph.cycles_truncated
            ? "The backend reports a bounded cycle list; additional cycles may exist within strong components."
            : analysisId
              ? "Cycles reported by the backend."
              : "Cycle entries in the bundled demonstration model."}
        </p>
        {state.cycle !== null && graph.cycles[state.cycle] ? (
          <div className="cycle-detail">
            <strong>Cycle {state.cycle + 1}</strong>
            <p>
              {graph.cycles[state.cycle].files.join(" → ")} →{" "}
              {graph.cycles[state.cycle].files[0]}
            </p>
            <button
              type="button"
              onClick={() =>
                choose(
                  `cycle:${(state.cycle! - 1 + graph.cycles.length) % graph.cycles.length}`,
                  "cycle",
                )
              }
            >
              Previous cycle
            </button>
            <button
              type="button"
              onClick={() =>
                choose(
                  `cycle:${(state.cycle! + 1) % graph.cycles.length}`,
                  "cycle",
                )
              }
            >
              Next cycle
            </button>
          </div>
        ) : null}
        <ul className="relationship-list">
          {graph.cycles.map((cycle, i) => (
            <li key={i}>
              <button
                type="button"
                aria-pressed={state.cycle === i}
                onClick={() => choose(`cycle:${i}`, "cycle")}
              >
                Cycle {i + 1} · {cycle.length} files
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="graph-panel-block">
        <h2>
          Strong components ({graph.strongly_connected_components.length})
        </h2>
        <p>
          SCCs group mutually reachable files; they are not an exhaustive list
          of simple cycles.
        </p>
        {graph.strongly_connected_components.map((members, i) => (
          <details key={i}>
            <summary>
              SCC {i + 1} · {members.length} files
            </summary>
            {members.map((id) => (
              <button key={id} type="button" onClick={() => choose(id)}>
                {index.nodes.get(id)?.path_name ?? id}
              </button>
            ))}
          </details>
        ))}
      </section>
      {analysisId ? (
        <section className="graph-panel-block">
          <h2>Backend ranking</h2>
          {graph.importance_ranking.slice(0, 20).map((id, i) => (
            <button type="button" key={id} onClick={() => choose(id)}>
              #{i + 1} {index.nodes.get(id)?.path_name ?? id}
            </button>
          ))}
        </section>
      ) : null}
    </>
  );
}
