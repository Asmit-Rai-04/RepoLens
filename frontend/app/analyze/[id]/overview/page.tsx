"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { BrandHeader } from "../../../../components/BrandHeader";
import { Overview } from "../../../../components/Overview";
import { getOverview, ApiError } from "../../../../lib/api/client";
import type { OverviewResponse } from "../../../../lib/api/types";

export default function OverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getOverview(id)
      .then((response) => {
        if (active) setData(response);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError ? caught.message : "Unable to load the repository overview.");
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (error) {
    return (
      <>
        <BrandHeader />
        <main className="centered">
          <div className="error-panel" style={{ width: "min(720px, 100%)" }} role="alert">
            <h2>Overview unavailable</h2>
            <p>{error}</p>
            <p style={{ marginTop: 18 }}><Link href="/" className="text-link">Analyze Another Repository</Link></p>
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
          <div className="loading-block" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <p>Loading repository overview…</p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <BrandHeader />
      <main className="overview-page">
        <div className="container">
          <div className="page-header">
            <div>
              <div className="page-kicker"><span className="kicker-accent">REPORT</span> / COMPLETE</div>
              <h1>{data.repository.owner}/{data.repository.name}</h1>
            </div>
            <nav className="action-rail" aria-label="Report actions">
              <Link href={`/analyze/${encodeURIComponent(id)}/architecture`} className="action-link"><span>ARCHITECTURE</span><span className="action-arrow" aria-hidden="true">↗</span></Link>
              <Link href={`/analyze/${encodeURIComponent(id)}/graph`} className="action-link"><span>DEPENDENCY GRAPH</span><span className="action-arrow" aria-hidden="true">↗</span></Link>
              <Link href={`/analyze/${encodeURIComponent(id)}/files`} className="action-link"><span>FILES</span><span className="action-arrow" aria-hidden="true">↗</span></Link>
              <Link href={`/analyze/${encodeURIComponent(id)}/insights`} className="action-link"><span>INSIGHTS</span><span className="action-arrow" aria-hidden="true">↗</span></Link>
              <Link href="/" className="action-link primary"><span>ANALYZE ANOTHER REPOSITORY</span><span className="action-arrow" aria-hidden="true">↗</span></Link>
            </nav>
          </div>
          <Overview data={data} />
        </div>
      </main>
    </>
  );
}
