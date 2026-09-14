import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Overview } from "../components/Overview";
import type { OverviewResponse } from "../lib/api/types";

const base: OverviewResponse = {
  repository: {
    owner: "octocat",
    name: "demo",
    canonical_url: "https://github.com/octocat/demo",
    default_branch: "main",
  },
  files: { total: 10, source_total: 8, by_language: { python: 8 } },
  architecture: { name: "Layered", confidence: 0.9, summary: "Layered architecture." },
  graph: { nodes: 8, edges: 12, cycles: 0, strongly_connected_components: 8 },
  violations: 0,
  completeness: { status: "complete", reason: null, skipped: { reasons: {} } },
};

describe("Overview partial-analysis notice", () => {
  it("renders no notice for a complete analysis", () => {
    render(<Overview data={base} />);
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText("octocat/demo")).toBeTruthy();
  });

  it("renders the notice with reason and skip summary for a partial analysis", () => {
    const partial: OverviewResponse = {
      ...base,
      completeness: {
        status: "partial",
        reason: "Extraction skipped content to stay within safe resource limits.",
        skipped: {
          reasons: { "oversized file": ["assets/a.bin"], "ignored directory content": Array.from({ length: 50 }, (_, i) => `vendor/v${i}`) },
        },
      },
    };
    render(<Overview data={partial} />);
    const note = screen.getByRole("note");
    expect(note).toBeTruthy();
    expect(screen.getByText("Partial analysis")).toBeTruthy();
    expect(screen.getByText(/Extraction skipped content/)).toBeTruthy();
    expect(screen.getByText("oversized file")).toBeTruthy();
    expect(screen.getByText("1 file")).toBeTruthy();
    expect(screen.getByText("50+ files")).toBeTruthy();
  });
});
