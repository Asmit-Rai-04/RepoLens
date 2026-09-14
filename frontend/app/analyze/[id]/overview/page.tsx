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
              <div className="page-kicker">Analysis complete</div>
              <h1>Repository overview.</h1>
            </div>
            <div className="page-actions"><Link href={`/analyze/${encodeURIComponent(id)}/architecture`} className="text-link">Open architecture map</Link><Link href={`/analyze/${encodeURIComponent(id)}/graph`} className="text-link">Open dependency graph</Link><Link href={`/analyze/${encodeURIComponent(id)}/files`} className="text-link">Explore repository</Link><Link href={`/analyze/${encodeURIComponent(id)}/insights`} className="text-link">Health &amp; insights</Link><Link href="/" className="text-link">Analyze Another Repository</Link></div>
          </div>
          <Overview data={data} />
        </div>
      </main>
    </>
  );
}
