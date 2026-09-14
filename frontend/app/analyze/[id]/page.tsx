"use client";

import Link from "next/link";
import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BrandHeader } from "../../../components/BrandHeader";
import { StageList } from "../../../components/StageList";
import { useAnalysis } from "../../../hooks/useAnalysis";

export default function AnalysisProgressPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);
  const { data, loading, networkError } = useAnalysis(id);

  useEffect(() => {
    if (data?.status === "completed") {
      router.replace(`/analyze/${encodeURIComponent(id)}/overview`);
    }
  }, [data?.status, id, router]);

  if (loading && !data) {
    return (
      <>
        <BrandHeader />
        <main className="centered">
          <div className="loading-block" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <p>Connecting to the analysis service…</p>
          </div>
        </main>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <BrandHeader />
        <main className="centered">
          <div className="error-panel" style={{ width: "min(720px, 100%)" }}>
            <h2>Analysis unavailable</h2>
            <p>{networkError ?? "The requested analysis could not be loaded."}</p>
            <p style={{ marginTop: 18 }}><Link className="text-link" href="/">Analyze Another Repository</Link></p>
          </div>
        </main>
      </>
    );
  }

  if (data.status === "failed") {
    return (
      <>
        <BrandHeader />
        <main className="progress-page">
          <div className="container">
            <div className="page-header">
              <div>
                <div className="page-kicker">Analysis failed</div>
                <h1>Repository analysis stopped.</h1>
              </div>
              <div className="page-actions"><Link href="/" className="text-link">Analyze Another Repository</Link></div>
            </div>
            <div className="error-panel" role="alert">
              <h2>{data.error?.type ?? "AnalysisError"}</h2>
              <p>{data.error?.message ?? "Repository analysis failed."}</p>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <BrandHeader />
      <main className="progress-page">
        <div className="container">
          <div className="page-header">
            <div>
              <div className="page-kicker">Analysis in progress</div>
              <h1>Reading the repository.</h1>
            </div>
            <div className="page-actions">
              <span className="mono muted" aria-live="polite">{data.stage}</span>
            </div>
          </div>
          <section className="progress-frame" aria-labelledby="progress-heading">
            <h2 id="progress-heading" className="section-title">Pipeline</h2>
            <StageList stage={data.stage} />
            {networkError ? <p className="form-error" role="status">{networkError} Retrying…</p> : null}
          </section>
        </div>
      </main>
    </>
  );
}

