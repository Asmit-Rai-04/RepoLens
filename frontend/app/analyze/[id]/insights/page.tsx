"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandHeader } from "../../../../components/BrandHeader";
import { InsightsDashboard } from "../../../../components/InsightsDashboard";
import { ApiError, getInsights } from "../../../../lib/api/client";
import type { InsightsReport } from "../../../../lib/api/intelligence-types";

export default function InsightsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [report, setReport] = useState<InsightsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);
    getInsights(id).then((data) => { if (active) setReport(data); }).catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "Unable to load repository insights."); });
    return () => { active = false; };
  }, [id]);

  return (
    <>
      <BrandHeader />
      <main className="overview-page insights-page">
        <div className="container">
          {error ? (
            <div className="error-panel" role="alert">
              <div className="page-kicker">Repository intelligence</div>
              <h1>Insights unavailable.</h1>
              <p>{error}</p>
              <p style={{ marginTop: 18 }}><Link href={`/analyze/${encodeURIComponent(id)}/overview`} className="text-link">Return to overview</Link></p>
            </div>
          ) : !report ? (
            <div className="loading-block" role="status" aria-live="polite"><div className="spinner" aria-hidden="true" /><p>Calculating deterministic repository insights…</p></div>
          ) : <InsightsDashboard analysisId={id} report={report} />}
        </div>
      </main>
    </>
  );
}
