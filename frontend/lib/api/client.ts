import type {
  AnalysisCreatedResponse,
  AnalysisRequest,
  AnalysisStatusResponse,
  OverviewResponse,
} from "./types";
import type { ArchitectureResponse } from "./architecture-types";
import type { FileDetailResponse, FileSummary, SourceResponse } from "./file-types";
import type { DependencyGraphResult } from "./graph-types";
import type { HealthReport, InsightsReport } from "./intelligence-types";

export class ApiError extends Error {
  readonly status: number;
  readonly type: string | null;

  constructor(message: string, status: number, type: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
  }
}

const baseUrl = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api").replace(/\/$/, "");

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError("Unable to reach the RepoLens backend.", 0);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof payload === "object" && payload !== null && "detail" in payload ? payload.detail : null;
    const detailRecord = typeof detail === "object" && detail !== null ? detail as Record<string, unknown> : null;
    const message = typeof detailRecord?.message === "string" ? detailRecord.message : "The request could not be completed.";
    const type = typeof detailRecord?.type === "string" ? detailRecord.type : null;
    throw new ApiError(message, response.status, type);
  }
  return payload as T;
}

export function createAnalysis(repositoryUrl: string): Promise<AnalysisCreatedResponse> {
  const body: AnalysisRequest = { repository_url: repositoryUrl };
  return requestJson<AnalysisCreatedResponse>(`${baseUrl}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getAnalysis(analysisId: string): Promise<AnalysisStatusResponse> {
  return requestJson<AnalysisStatusResponse>(`${baseUrl}/analyze/${encodeURIComponent(analysisId)}`);
}

export function getOverview(analysisId: string): Promise<OverviewResponse> {
  return requestJson<OverviewResponse>(`${baseUrl}/analyze/${encodeURIComponent(analysisId)}/overview`);
}

export function getArchitecture(analysisId: string): Promise<ArchitectureResponse> {
  return requestJson<ArchitectureResponse>(`${baseUrl}/analyze/${encodeURIComponent(analysisId)}/architecture`);
}


export function getDependencyGraph(analysisId: string): Promise<DependencyGraphResult> {
  return requestJson<DependencyGraphResult>(`${baseUrl}/analyze/${encodeURIComponent(analysisId)}/graph`);
}

export function getHealth(analysisId: string): Promise<HealthReport> {
  return requestJson<HealthReport>(`${baseUrl}/analyze/${encodeURIComponent(analysisId)}/health`);
}

export function getInsights(analysisId: string): Promise<InsightsReport> {
  return requestJson<InsightsReport>(`${baseUrl}/analyze/${encodeURIComponent(analysisId)}/insights`);
}

export function getApiBaseUrl(): string {
  return baseUrl;
}

export function listFiles(analysisId: string): Promise<FileSummary[]> {
  return requestJson<FileSummary[]>(`${baseUrl}/analyze/${encodeURIComponent(analysisId)}/files`);
}

/**
 * Encodes a repository-relative path for a URL path segment.
 *
 * Each segment is encoded separately so the `/` separators stay intact; encoding the whole
 * path would send `%2F` and rely on server-side decoding quirks.
 */
export function encodeRepositoryPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function getFile(analysisId: string, path: string): Promise<FileDetailResponse> {
  return requestJson<FileDetailResponse>(`${baseUrl}/analyze/${encodeURIComponent(analysisId)}/files/${encodeRepositoryPath(path)}`);
}

export function getSource(analysisId: string, path: string): Promise<SourceResponse> {
  return requestJson<SourceResponse>(`${baseUrl}/analyze/${encodeURIComponent(analysisId)}/source/${encodeRepositoryPath(path)}`);
}
