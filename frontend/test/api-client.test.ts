import { describe, expect, it, vi, beforeEach } from "vitest";
import { ApiError, createAnalysis, getAnalysis, getOverview, listFiles, getFile, getSource } from "../lib/api/client";

describe("API client", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates an analysis with the backend request contract", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ analysis_id: "abc", status: "queued" }), { status: 202 }));
    await expect(createAnalysis("https://github.com/user/repository")).resolves.toEqual({ analysis_id: "abc", status: "queued" });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/api/analyze", expect.objectContaining({ method: "POST", body: JSON.stringify({ repository_url: "https://github.com/user/repository" }) }));
  });

  it("reads status and overview from the actual endpoint shapes", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/overview")) return new Response(JSON.stringify({ repository: { owner: "u", name: "r", canonical_url: "https://github.com/u/r", default_branch: "main" }, files: { total: 2, by_language: { python: 2 } }, architecture: { name: "Simple/Flat", confidence: 0.4, summary: "Simple repository." }, graph: { nodes: 2, edges: 1, cycles: 0, strongly_connected_components: 0 }, violations: 0 }));
      return new Response(JSON.stringify({ analysis_id: "abc", status: "running", stage: "parsing", error: null }));
    });
    await expect(getAnalysis("abc")).resolves.toMatchObject({ status: "running", stage: "parsing" });
    await expect(getOverview("abc")).resolves.toMatchObject({ files: { total: 2 } });
  });

  it("reads the bulk file, file detail, and source endpoints", async () => {
    const calls: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/files")) return new Response(JSON.stringify([{ path: "src/main.py", language: "python", parse_status: "success", layer: "service", size_bytes: 42, symbol_count: 2, import_count: 1 }]));
      if (url.includes("/source/")) return new Response(JSON.stringify({ path: "src/main.py", content: "def main():\n  return 1", language: "python" }));
      return new Response(JSON.stringify({ source_file: { path: "src/main.py", kind: "source", language: "python", parse_status: "success", parse_error: null, size_bytes: 42, package_name: null, symbols: [], imports: [], inheritance: [] }, layer: "service", resolved_imports: [], unresolved_imports: [], external_imports: [] }));
    });
    await expect(listFiles("abc")).resolves.toHaveLength(1);
    await expect(getFile("abc", "src/main.py")).resolves.toMatchObject({ source_file: { path: "src/main.py" }, layer: "service" });
    await expect(getSource("abc", "src/main.py")).resolves.toMatchObject({ path: "src/main.py" });
    expect(calls).toContain("http://localhost:8000/api/analyze/abc/files/src/main.py");
    expect(calls).toContain("http://localhost:8000/api/analyze/abc/source/src/main.py");
  });

  it("surfaces sanitized backend errors without raw response details", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ detail: { type: "RepositoryNotFound", message: "Repository not found." } }), { status: 404 }));
    await expect(getAnalysis("missing")).rejects.toMatchObject({ status: 404, message: "Repository not found.", type: "RepositoryNotFound" } satisfies Partial<ApiError>);
  });
});
