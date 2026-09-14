import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InsightsDashboard } from "../components/InsightsDashboard";
import type { InsightsReport } from "../lib/api/intelligence-types";

const report: InsightsReport = {
  summary: {
    repository_name: "repo",
    total_files: 12,
    source_files: 10,
    languages: { python: 8, typescript: 2 },
    architecture: "Layered",
    architecture_confidence: 0.92,
    dependency_count: 16,
    cycle_count: 1,
    scc_count: 1,
    unresolved_imports: 2,
    architecture_violations: 1,
    health_score: 72.4,
  },
  health: {
    score: 72.4,
    status: "fair",
    weights: { parse: 0.2, imports: 0.2, cycles: 0.2, architecture: 0.25, coupling: 0.15 },
    dimensions: {
      parse: { score: 100, status: "excellent", explanation: "10 of 10 parsed.", metrics: { successful: 10, attempted: 10 } },
      imports: { score: 80, status: "good", explanation: "2 unresolved.", metrics: { resolved: 8, unresolved: 2, external: 4 } },
      cycles: { score: 68, status: "fair", explanation: "1 cycle.", metrics: { cycles: 1, cycle_files: 3, largest_scc: 3, severity: "medium" } },
      architecture: { score: 82, status: "good", explanation: "Layered with one violation.", metrics: { confidence: 0.92, violations: 1 } },
      coupling: { score: 66, status: "fair", explanation: "1 hotspot.", metrics: { hotspots: 1 } },
    },
    coupling_hotspots: [{ path: "service.py", incoming_dependencies: 5, outgoing_dependencies: 2, centrality: 0.42, importance: 7.42, rank: 1, reason: "High incoming dependency count: 5 files depend on this file." }],
    cycle_severity: [{ files: ["a.py", "b.py", "c.py"], length: 3, severity: "medium", reason: "Cycle includes 3 files." }],
    problem_files: [{ path: "service.py", reasons: ["High incoming dependency count"], metrics: { incoming_dependencies: 5 } }],
  },
  key_findings: [
    { severity: "high", category: "architecture_violation", title: "Skipped Layer", description: "Controller directly depends on Repository.", related_files: ["controller.py", "repository.py"] },
    { severity: "medium", category: "dependency_cycle", title: "Dependency cycle detected", description: "3 files participate in 1 dependency cycle.", related_files: ["a.py", "b.py", "c.py"] },
  ],
  coupling_hotspots: [{ path: "service.py", incoming_dependencies: 5, outgoing_dependencies: 2, centrality: 0.42, importance: 7.42, rank: 1, reason: "High incoming dependency count: 5 files depend on this file." }],
  cycle_severity: [{ files: ["a.py", "b.py", "c.py"], length: 3, severity: "medium", reason: "Cycle includes 3 files." }],
  problem_files: [{ path: "service.py", reasons: ["High incoming dependency count"], metrics: { incoming_dependencies: 5 } }],
  architecture_violations: [{ kind: "skipped_layer", source: "controller.py", target: "repository.py", source_layer: "controller", target_layer: "repository", description: "Controller directly depends on Repository.", severity: "high" }],
  clean_state: false,
  clean_state_message: null,
};

describe("InsightsDashboard", () => {
  it("renders real health data and dimension details", () => {
    render(<InsightsDashboard analysisId="abc" report={report} />);
    expect(screen.getByText("72.4")).toBeInTheDocument();
    expect(screen.getByText("Dimension breakdown")).toBeInTheDocument();
    expect(screen.getByText("Imports")).toBeInTheDocument();
    expect(screen.getByText("2 unresolved.")).toBeInTheDocument();
  });

  it("sends every finding to the view that can act on it", () => {
    render(<InsightsDashboard analysisId="abc" report={report} />);
    // The violation appears both as a finding and in the violations list, so assert on the set.
    const violationLinks = screen.getAllByRole("link", { name: /Skipped Layer/i });
    expect(violationLinks.length).toBeGreaterThan(0);
    for (const link of violationLinks) expect(link).toHaveAttribute("href", "/analyze/abc/architecture");
    // The cycle deep link carries the exact member files from the finding.
    const cycleLink = screen.getAllByRole("link", { name: /dependency cycle/i })[0];
    expect(cycleLink.getAttribute("href")).toBe(
      `/analyze/abc/graph?cycle=${encodeURIComponent("a.py,b.py,c.py")}`,
    );
    expect(screen.getAllByRole("link", { name: /service\.py/i })[0]).toHaveAttribute("href", "/analyze/abc/graph?file=service.py");
  });

  it("shows clean-state messaging when the backend says the repository is clean", () => {
    render(<InsightsDashboard analysisId="abc" report={{ ...report, clean_state: true, clean_state_message: "All clear." , key_findings: [], coupling_hotspots: [], cycle_severity: [], problem_files: [], architecture_violations: [] }} />);
    expect(screen.getByText("No repository health blockers detected.")).toBeInTheDocument();
    expect(screen.getByText("All clear.")).toBeInTheDocument();
  });
});
