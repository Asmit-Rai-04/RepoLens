export type HealthStatus = "excellent" | "good" | "fair" | "poor" | "critical";
export type FindingSeverity = "info" | "low" | "medium" | "high" | "critical";

export interface HealthDimension {
  score: number;
  status: HealthStatus;
  explanation: string;
  metrics: Record<string, number | string | boolean | null>;
}

export interface HealthWeights {
  parse: number;
  imports: number;
  cycles: number;
  architecture: number;
  coupling: number;
}

export interface CycleSeverity {
  files: string[];
  length: number;
  severity: FindingSeverity;
  reason: string;
}

export interface CouplingHotspot {
  path: string;
  incoming_dependencies: number;
  outgoing_dependencies: number;
  centrality: number;
  importance: number;
  rank: number;
  reason: string;
}

export interface ProblemFile {
  path: string;
  reasons: string[];
  metrics: Record<string, number | string | boolean | null>;
}

export interface ArchitectureViolationInsight {
  kind: string;
  source: string;
  target: string;
  source_layer: string;
  target_layer: string;
  description: string;
  severity: FindingSeverity;
}

export interface KeyFinding {
  severity: FindingSeverity;
  category: string;
  title: string;
  description: string;
  related_files: string[];
}

export interface RepositorySummary {
  repository_name: string;
  total_files: number;
  source_files: number;
  languages: Record<string, number>;
  architecture: string;
  architecture_confidence: number;
  dependency_count: number;
  cycle_count: number;
  scc_count: number;
  unresolved_imports: number;
  architecture_violations: number;
  health_score: number;
}

export interface HealthReport {
  score: number;
  status: HealthStatus;
  weights: HealthWeights;
  dimensions: Record<string, HealthDimension>;
  coupling_hotspots: CouplingHotspot[];
  cycle_severity: CycleSeverity[];
  problem_files: ProblemFile[];
}

export interface InsightsReport {
  summary: RepositorySummary;
  health: HealthReport;
  key_findings: KeyFinding[];
  coupling_hotspots: CouplingHotspot[];
  cycle_severity: CycleSeverity[];
  problem_files: ProblemFile[];
  architecture_violations: ArchitectureViolationInsight[];
  clean_state: boolean;
  clean_state_message: string | null;
}
