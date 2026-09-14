/**
 * URL helpers for the analysis routes.
 *
 * Repository file paths contain `/` separators that must stay literal in the URL so the
 * `[...path]` catch-all route builds the correct segment array. Encoding the whole path would
 * emit `%2F` and depend on server-side decoding behaviour, so each segment is encoded alone.
 */

export function encodeRepositoryPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function analysisHref(analysisId: string, suffix = ""): string {
  return `/analyze/${encodeURIComponent(analysisId)}${suffix}`;
}

export function fileHref(analysisId: string, path: string, query?: Record<string, string>): string {
  const base = `${analysisHref(analysisId, "/files")}/${encodeRepositoryPath(path)}`;
  if (!query) return base;
  const params = new URLSearchParams(query).toString();
  return params ? `${base}?${params}` : base;
}

export function graphHref(analysisId: string, query: Record<string, string>): string {
  const params = new URLSearchParams(query).toString();
  const base = analysisHref(analysisId, "/graph");
  return params ? `${base}?${params}` : base;
}
