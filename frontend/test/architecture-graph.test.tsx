import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { ArchitectureGraph } from "../components/ArchitectureGraph";

vi.mock("next/link", () => ({ default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));

const data = {
  report: {
    primary: {
      architecture: "Layered" as const,
      confidence: 0.87,
      evidence: [],
      layers: [
        { name: "controller", paths: ["src/controller/A.ts"], expected_dependencies: ["service"], forbidden_dependencies: ["repository"], observed_dependencies: ["service"] },
        { name: "service", paths: ["src/service/A.ts", "src/service/B.ts"], expected_dependencies: ["repository"], forbidden_dependencies: [], observed_dependencies: ["repository"] },
      ],
      violations: [{ kind: "skipped_layer", source: "A", target: "R", source_layer: "controller", target_layer: "repository", description: "Controller directly depends on Repository.", evidence: [] }],
      framework_evidence: [],
    },
    alternatives: [],
    monorepo: { is_monorepo: false, roots: [], evidence: [] },
    summary: "Layered architecture.",
    layer_map: {},
    metadata: {},
  },
  layer_edges: [
    { source_layer: "controller", target_layer: "service", import_count: 3, supporting_files: ["src/controller/A.ts", "src/service/A.ts"], violation: false },
    { source_layer: "controller", target_layer: "repository", import_count: 1, supporting_files: ["src/controller/A.ts", "src/repository/R.ts"], violation: true },
  ],
};

describe("architecture graph", () => {
  it("renders real layers, counts, and the layer inspector shell", () => {
    render(<ArchitectureGraph data={data} analysisId="abc" />);
    expect(screen.getByText("controller")).toBeInTheDocument();
    expect(screen.getByText("service")).toBeInTheDocument();
    expect(screen.getByText("2 files")).toBeInTheDocument();
    expect(screen.getByText("0 violations")).toBeInTheDocument();
    expect(screen.getByText("Layer details")).toBeInTheDocument();
  });
});
