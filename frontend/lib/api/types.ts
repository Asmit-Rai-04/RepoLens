export type SupportedLanguage = "python" | "javascript" | "typescript" | "tsx" | "java";
export type ParseStatus = "success" | "error" | "empty" | "unsupported";

export type AnalysisStatus = "queued" | "running" | "completed" | "failed";
export type AnalysisStage =
  | "queued"
  | "ingesting"
  | "parsing"
  | "building_graph"
  | "detecting_architecture"
  | "completed"
  | "failed";

export interface AnalysisRequest {
  repository_url: string;
}

export interface AnalysisCreatedResponse {
  analysis_id: string;
  status: string;
}

export interface AnalysisError {
  type: string;
  message: string;
}

export interface AnalysisCompleteness {
  status: "complete" | "partial";
  reason?: string | null;
  skipped: { reasons: Record<string, string[]> };
}

export interface AnalysisStatusResponse {
  analysis_id: string;
  status: AnalysisStatus;
  stage: AnalysisStage;
  created_at?: string | null;
  updated_at?: string | null;
  error?: AnalysisError | null;
  completeness?: AnalysisCompleteness | null;
}

export interface RepositoryOverview {
  owner: string;
  name: string;
  canonical_url: string;
  default_branch: string;
}

export interface OverviewFiles {
  total: number;
  source_total: number;
  by_language: Record<string, number>;
}

export interface OverviewArchitecture {
  name: string;
  confidence: number;
  summary: string;
}

export interface OverviewGraph {
  nodes: number;
  edges: number;
  cycles: number;
  strongly_connected_components: number;
}

export interface OverviewResponse {
  repository: RepositoryOverview;
  files: OverviewFiles;
  architecture: OverviewArchitecture;
  graph: OverviewGraph;
  violations: number;
  completeness: AnalysisCompleteness;
}
