import type { AnalysisStage } from "../lib/api/types";

const stages: Array<{ key: Exclude<AnalysisStage, "failed">; label: string }> = [
  { key: "queued", label: "QUEUED" },
  { key: "ingesting", label: "INGESTING" },
  { key: "parsing", label: "PARSING" },
  { key: "building_graph", label: "BUILDING GRAPH" },
  { key: "detecting_architecture", label: "DETECTING ARCHITECTURE" },
  { key: "completed", label: "COMPLETED" },
];

function stateFor(stage: AnalysisStage, key: Exclude<AnalysisStage, "failed">): "active" | "complete" | "future" {
  const current = stage === "failed" ? "completed" : stage;
  const currentIndex = stages.findIndex((item) => item.key === current);
  const keyIndex = stages.findIndex((item) => item.key === key);
  if (keyIndex < currentIndex) return "complete";
  if (keyIndex === currentIndex) return "active";
  return "future";
}

export function StageList({ stage }: { stage: AnalysisStage }) {
  return (
    <ol className="stage-list" aria-label="Analysis stages">
      {stages.map((item, index) => {
        const state = stateFor(stage, item.key);
        return (
          <li key={item.key} className={`stage-item ${state}`}>
            <span className="status-dot" aria-hidden="true" />
            <span className="stage-number">0{index + 1}</span>
            <span className="stage-name">{item.label}</span>
            <span className="stage-state">
              {state === "active" ? "IN PROGRESS" : state === "complete" ? "DONE" : "WAITING"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
