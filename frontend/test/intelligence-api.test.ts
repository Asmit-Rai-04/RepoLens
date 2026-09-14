import { describe, expect, it, vi } from "vitest";
import { getHealth, getInsights } from "../lib/api/client";

describe("intelligence API client", () => {
  it("calls the health endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ score: 80 }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await getHealth("abc");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/api/analyze/abc/health", expect.objectContaining({ headers: { Accept: "application/json" } }));
  });

  it("calls the insights endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ summary: {} }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await getInsights("abc");
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/api/analyze/abc/insights", expect.objectContaining({ headers: { Accept: "application/json" } }));
  });
});
