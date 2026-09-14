import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useAnalysis } from "../hooks/useAnalysis";
import { getAnalysis } from "../lib/api/client";

vi.mock("../lib/api/client", async () => {
  const actual = await vi.importActual<typeof import("../lib/api/client")>("../lib/api/client");
  return { ...actual, getAnalysis: vi.fn() };
});

describe("useAnalysis", () => {
  it("polls through backend stages and stops on completion", async () => {
    const mocked = vi.mocked(getAnalysis);
    mocked
      .mockResolvedValueOnce({ analysis_id: "abc", status: "queued", stage: "queued", error: null })
      .mockResolvedValueOnce({ analysis_id: "abc", status: "running", stage: "parsing", error: null })
      .mockResolvedValueOnce({ analysis_id: "abc", status: "completed", stage: "completed", error: null });

    const { result, unmount } = renderHook(() => useAnalysis("abc"));
    await waitFor(() => expect(result.current.data?.stage).toBe("queued"));
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await waitFor(() => expect(result.current.data?.stage).toBe("parsing"));
    await new Promise((resolve) => setTimeout(resolve, 1600));
    await waitFor(() => expect(result.current.data?.status).toBe("completed"));
    const callsAfterCompletion = mocked.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 1700));
    expect(mocked.mock.calls.length).toBe(callsAfterCompletion);
    unmount();
  });
});
