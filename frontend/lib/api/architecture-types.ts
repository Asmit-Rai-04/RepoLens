export type ArchitectureType =
  | "Layered"
  | "MVC"
  | "Service/Repository Pattern"
  | "Frontend/Backend Separation"
  | "Monorepo"
  | "Simple/Flat"
  | "Unknown";

export interface ArchitectureEvidence {
  type: string;
  description: string;
  supporting_paths: string[];
  weight: number;
}

export interface LayerInfo {
  name: string;
  paths: string[];
  expected_dependencies: string[];
  forbidden_dependencies: string[];
  observed_dependencies: string[];
}

export interface FrameworkEvidence {
  framework: string;
  supporting_paths: string[];
  evidence: string[];
}

export interface ArchitectureViolation {
  kind: string;
  source: string;
  target: string;
  source_layer: string;
  target_layer: string;
  description: string;
  evidence: string[];
}

export interface ArchitectureCandidate {
  architecture: ArchitectureType;
  confidence: number;
  evidence: ArchitectureEvidence[];
  layers: LayerInfo[];
  violations: ArchitectureViolation[];
  framework_evidence: FrameworkEvidence[];
}

export interface MonorepoInfo {
  is_monorepo: boolean;
  roots: string[];
  evidence: ArchitectureEvidence[];
}

export interface ArchitectureReport {
  primary: ArchitectureCandidate;
  alternatives: ArchitectureCandidate[];
  monorepo: MonorepoInfo;
  summary: string;
  layer_map: Record<string, string>;
  metadata: Record<string, unknown>;
}

export interface LayerEdge {
  source_layer: string;
  target_layer: string;
  import_count: number;
  supporting_files: string[];
  violation: boolean;
}

export interface ArchitectureResponse {
  report: ArchitectureReport;
  layer_edges: LayerEdge[];
}
