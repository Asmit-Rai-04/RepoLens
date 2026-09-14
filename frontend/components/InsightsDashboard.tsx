"use client";

import Link from "next/link";
import { HealthDimension } from "./HealthDimension";
import type { InsightsReport, KeyFinding, ProblemFile } from "../lib/api/intelligence-types";
import { analysisHref, fileHref, graphHref } from "../lib/routes";

/**
 * Sends a finding to the view that can act on it: violations to the architecture map,
 * cycles and hotspots to the focused dependency graph, everything else to the file inspector.
 */
function findingLink(analysisId: string, finding: KeyFinding): string | null {
  const firstFile = finding.related_files[0];
  if (finding.category === "dependency_cycle" && finding.related_files.length) {
    return graphHref(analysisId, { cycle: finding.related_files.join(",") });
  }
  if (finding.category === "high_coupling" && firstFile) {
    return graphHref(analysisId, { file: firstFile });
  }
  if ((finding.category === "unresolved_imports" || finding.category === "parse_failures") && firstFile) {
    return fileHref(analysisId, firstFile);
  }
  if (finding.category === "architecture_violation") {
    return analysisHref(analysisId, "/architecture");
  }
  return null;
}

function severityClass(severity: string) {
  return `severity-${severity}`;
}

export function InsightsDashboard({ analysisId, report }: { analysisId: string; report: InsightsReport }) {
  const dimensions = report.health.dimensions;
  return (
    <div className="insights-layout">
      <header className="insights-score-block">
        <div>
          <div className="page-kicker">Repository intelligence</div>
          <h1>Health &amp; insights.</h1>
          <p className="page-lede">Every score and finding below is derived from the completed repository analysis. No generated or inferred repository facts are added.</p>
        </div>
        <div className="health-score" aria-label={`Repository health ${report.health.score.toFixed(1)} out of 100`}>
          <span>HEALTH</span>
          <strong>{report.health.score.toFixed(1)}</strong>
          <em>{report.health.status}</em>
        </div>
      </header>

      {report.clean_state ? (
        <section className="clean-state" role="status">
          <span className="clean-state-mark" aria-hidden="true">✓</span>
          <div><div className="section-kicker">All clear</div><h2>No repository health blockers detected.</h2><p>{report.clean_state_message}</p></div>
        </section>
      ) : null}

      <section className="insights-section" aria-labelledby="dimensions-heading">
        <div className="section-heading-row"><div><div className="section-kicker">Weighted health</div><h2 id="dimensions-heading">Dimension breakdown</h2></div><span className="technical-count">20 / 20 / 20 / 25 / 15</span></div>
        <div className="health-dimension-grid">
          <HealthDimension name="Parse" dimension={dimensions.parse} />
          <HealthDimension name="Imports" dimension={dimensions.imports} />
          <HealthDimension name="Cycles" dimension={dimensions.cycles} />
          <HealthDimension name="Architecture" dimension={dimensions.architecture} />
          <HealthDimension name="Coupling" dimension={dimensions.coupling} />
        </div>
      </section>

      <section className="insights-section" aria-labelledby="summary-heading">
        <div className="section-kicker">Repository summary</div>
        <h2 id="summary-heading">What the analysis found.</h2>
        <dl className="summary-grid">
          <div><dt>Repository</dt><dd>{report.summary.repository_name}</dd></div>
          <div><dt>Files</dt><dd>{report.summary.total_files}</dd></div>
          <div><dt>Source files</dt><dd>{report.summary.source_files}</dd></div>
          <div><dt>Dependencies</dt><dd>{report.summary.dependency_count}</dd></div>
          <div><dt>Cycles</dt><dd>{report.summary.cycle_count}</dd></div>
          <div><dt>SCCs</dt><dd>{report.summary.scc_count}</dd></div>
          <div><dt>Unresolved imports</dt><dd>{report.summary.unresolved_imports}</dd></div>
          <div><dt>Violations</dt><dd>{report.summary.architecture_violations}</dd></div>
          <div><dt>Architecture</dt><dd>{report.summary.architecture}</dd></div>
          <div><dt>Confidence</dt><dd>{(report.summary.architecture_confidence * 100).toFixed(0)}%</dd></div>
        </dl>
      </section>

      <section className="insights-section" aria-labelledby="findings-heading">
        <div className="section-heading-row"><div><div className="section-kicker">Findings</div><h2 id="findings-heading">What deserves attention.</h2></div><span className="technical-count">{report.key_findings.length}</span></div>
        {report.key_findings.length ? (
          <div className="finding-list">
            {report.key_findings.map((finding, index) => {
              const href = findingLink(analysisId, finding);
              const body = <><span className={`severity-chip ${severityClass(finding.severity)}`}>{finding.severity}</span><div><strong>{finding.title}</strong><p>{finding.description}</p>{finding.related_files.length ? <code>{finding.related_files.slice(0, 4).join(" · ")}</code> : null}</div></>;
              return href ? <Link href={href} key={`${finding.category}-${finding.title}-${index}`} className="finding-row">{body}<span className="finding-arrow" aria-hidden="true">→</span></Link> : <div key={`${finding.category}-${finding.title}-${index}`} className="finding-row">{body}</div>;
            })}
          </div>
        ) : <div className="empty-insight">No key findings were generated from the available analysis evidence.</div>}
      </section>

      <section className="insights-two-column">
        <section className="insights-section" aria-labelledby="hotspots-heading">
          <div className="section-kicker">Coupling</div><h2 id="hotspots-heading">Hotspots</h2>
          {report.coupling_hotspots.length ? <div className="hotspot-list">{report.coupling_hotspots.map((hotspot) => <Link key={hotspot.path} href={graphHref(analysisId, { file: hotspot.path })} className="hotspot-row"><span className="rank-number">#{hotspot.rank}</span><div><strong>{hotspot.path}</strong><p>{hotspot.reason}</p></div><span className="hotspot-score">{hotspot.importance.toFixed(2)}</span></Link>)}</div> : <div className="empty-insight">No coupling hotspots crossed the deterministic thresholds.</div>}
        </section>
        <section className="insights-section" aria-labelledby="cycles-heading">
          <div className="section-kicker">Cycles</div><h2 id="cycles-heading">Cycle severity</h2>
          {report.cycle_severity.length ? <div className="cycle-list">{report.cycle_severity.map((cycle, index) => <Link key={`${cycle.files.join("::")}-${index}`} href={graphHref(analysisId, { cycle: cycle.files.join(",") })} className="cycle-row"><span className={`severity-chip ${severityClass(cycle.severity)}`}>{cycle.severity}</span><div><strong>{cycle.length}-file cycle</strong><p>{cycle.reason}</p><code>{cycle.files.join(" → ")}</code></div></Link>)}</div> : <div className="empty-insight">No dependency cycles were detected.</div>}
        </section>
      </section>

      <section className="insights-two-column">
        <section className="insights-section" aria-labelledby="problem-files-heading">
          <div className="section-kicker">Problem files</div><h2 id="problem-files-heading">Files to inspect.</h2>
          {report.problem_files.length ? <div className="problem-list">{report.problem_files.slice(0, 20).map((item: ProblemFile) => <Link key={item.path} href={fileHref(analysisId, item.path)} className="problem-row"><code>{item.path}</code><span>{item.reasons.length} reason{item.reasons.length === 1 ? "" : "s"}</span><small>{item.reasons[0]}</small></Link>)}</div> : <div className="empty-insight">No problem files were identified by the deterministic rules.</div>}
        </section>
        <section className="insights-section" aria-labelledby="architecture-violations-heading">
          <div className="section-kicker">Architecture</div><h2 id="architecture-violations-heading">Violations.</h2>
          {report.architecture_violations.length ? <div className="violation-list">{report.architecture_violations.map((violation, index) => <Link key={`${violation.kind}-${violation.source}-${violation.target}-${index}`} href={analysisHref(analysisId, "/architecture")} className="violation-row"><span className={`severity-chip ${severityClass(violation.severity)}`}>{violation.severity}</span><div><strong>{violation.kind.replaceAll("_", " ")}</strong><p>{violation.description}</p><code>{violation.source} → {violation.target}</code></div></Link>)}</div> : <div className="empty-insight">No architecture violations were reported.</div>}
        </section>
      </section>

      <div className="insights-nav-row">
        <Link href={analysisHref(analysisId, "/overview")} className="text-link">Overview</Link>
        <Link href={analysisHref(analysisId, "/architecture")} className="text-link">Architecture</Link>
        <Link href={analysisHref(analysisId, "/files")} className="text-link">Explore files</Link>
        <Link href={analysisHref(analysisId, "/graph")} className="text-link">Dependency graph</Link>
      </div>
    </div>
  );
}
