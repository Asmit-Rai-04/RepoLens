import type { OverviewResponse } from "../lib/api/types";

export function Overview({ data }: { data: OverviewResponse }) {
  const languageEntries = Object.entries(data.files.by_language).sort((a, b) => b[1] - a[1]);
  const completeness = data.completeness;
  const partial = completeness?.status === "partial";
  return (
    <>
      {partial && completeness && (
        <section className="section" aria-label="Partial analysis notice">
          <div className="panel partial-notice" role="note">
            <h2 className="partial-title">Partial analysis</h2>
            <p className="summary">
              {completeness.reason ??
                "Some repository content was skipped to stay within safe resource limits."}
            </p>
            {Object.keys(completeness.skipped.reasons).length > 0 && (
              <ul className="partial-skipped">
                {Object.entries(completeness.skipped.reasons).map(([reason, names]) => (
                  <li key={reason}>
                    <span className="partial-reason">{reason}</span>
                    <span className="muted">
                      {names.length < 50 ? `${names.length} file${names.length === 1 ? "" : "s"}` : "50+ files"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
      <section className="overview-grid" aria-labelledby="overview-heading">
        <div className="panel">
          <h2 id="overview-heading">Repository</h2>
          <h1 className="repo-name">{data.repository.owner}/{data.repository.name}</h1>
          <div className="repo-meta">
            <span>{data.repository.default_branch}</span>
            <span aria-hidden="true">/</span>
            <a className="repo-url" href={data.repository.canonical_url} target="_blank" rel="noreferrer">
              {data.repository.canonical_url}
            </a>
          </div>
        </div>

        <div className="panel">
          <h2>Architecture</h2>
          <p className="architecture-name">{data.architecture.name}</p>
          <div className="confidence">
            <span className="confidence-value">{Math.round(data.architecture.confidence * 100)}%</span>
            <span className="muted">confidence</span>
          </div>
          <p className="summary">{data.architecture.summary}</p>
        </div>
      </section>

      <section className="section" aria-labelledby="repository-metrics">
        <div className="metric-row" id="repository-metrics">
          <div className="metric"><div className="metric-label">Source files</div><div className="metric-value">{data.files.source_total}</div></div>
          <div className="metric"><div className="metric-label">Files discovered</div><div className="metric-value">{data.files.total}</div></div>
          <div className="metric"><div className="metric-label">Architecture violations</div><div className="metric-value">{data.violations}</div></div>
          <div className="metric"><div className="metric-label">Graph nodes</div><div className="metric-value">{data.graph.nodes}</div></div>
          <div className="metric"><div className="metric-label">Graph edges</div><div className="metric-value">{data.graph.edges}</div></div>
          <div className="metric"><div className="metric-label">Cycles</div><div className="metric-value">{data.graph.cycles}</div></div>
          <div className="metric"><div className="metric-label">Strongly connected components</div><div className="metric-value">{data.graph.strongly_connected_components}</div></div>
        </div>
      </section>

      <section className="section" aria-labelledby="languages-heading">
        <h2 id="languages-heading" className="section-title">Languages</h2>
        <div className="language-list">
          {languageEntries.map(([language, count]) => (
            <div className="language-item" key={language}>
              <span>{language}</span>
              <span>{count}</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
