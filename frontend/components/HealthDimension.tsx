import type { HealthDimension as HealthDimensionData } from "../lib/api/intelligence-types";

export function HealthDimension({ name, dimension }: { name: string; dimension: HealthDimensionData }) {
  const metricEntries = Object.entries(dimension.metrics).slice(0, 4);
  return (
    <section className="health-dimension" aria-labelledby={`health-${name}`}>
      <div className="health-dimension-head">
        <div>
          <div className="section-kicker">Health dimension</div>
          <h2 id={`health-${name}`}>{name}</h2>
        </div>
        <div className="health-dimension-score">
          <strong>{dimension.score.toFixed(1)}</strong>
          <span>/ 100</span>
        </div>
      </div>
      <div className={`status-pill status-${dimension.status}`}><span aria-hidden="true" className="status-dot" />{dimension.status}</div>
      <p className="health-dimension-explanation">{dimension.explanation}</p>
      {metricEntries.length ? (
        <dl className="health-metrics">
          {metricEntries.map(([key, value]) => (
            <div key={key}><dt>{key.replaceAll("_", " ")}</dt><dd>{typeof value === "number" && !Number.isInteger(value) ? value.toFixed(3) : String(value)}</dd></div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
