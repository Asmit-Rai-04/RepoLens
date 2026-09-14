"use client";

import { useEffect, useState } from "react";
import { getAnalysis, ApiError } from "../lib/api/client";
import type { AnalysisStatusResponse } from "../lib/api/types";

interface UseAnalysisResult {
  data: AnalysisStatusResponse | null;
  loading: boolean;
  networkError: string | null;
}

export function useAnalysis(analysisId: string): UseAnalysisResult {
  const [data, setData] = useState<AnalysisStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await getAnalysis(analysisId);
        if (cancelled) return;
        setData(response);
        setLoading(false);
        setNetworkError(null);
        if (response.status === "completed" || response.status === "failed") return;
        timeoutId = setTimeout(poll, 1500);
      } catch (error) {
        if (cancelled) return;
        setLoading(false);
        setNetworkError(error instanceof ApiError ? error.message : "Unable to read analysis status.");
        timeoutId = setTimeout(poll, 2000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [analysisId]);

  return { data, loading, networkError };
}
