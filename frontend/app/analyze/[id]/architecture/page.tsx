"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { BrandHeader } from "../../../../components/BrandHeader";
import { ArchitectureGraph } from "../../../../components/ArchitectureGraph";
import { ApiError, getArchitecture } from "../../../../lib/api/client";
import type { ArchitectureResponse } from "../../../../lib/api/architecture-types";

export default function ArchitecturePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<ArchitectureResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getArchitecture(id)
      .then((response) => { if (active) setData(response); })
      .catch((caught) => { if (active) setError(caught instanceof ApiError ? caught.message : "Unable to load the architecture analysis."); });
    return () => { active = false; };
  }, [id]);

  if (error) {
    return (
      <>
        <BrandHeader />
        <main className="centered">
          <div className="error-panel" style={{ width: "min(720px, 100%)" }} role="alert">
            <h2>Architecture unavailable</h2>
            <p>{error}</p>
            <Link href={`/analyze/${encodeURIComponent(id)}/overview`} className="text-link">Return to overview</Link>
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
          <div className="loading-block" role="status" aria-live="polite"><div className="spinner" aria-hidden="true" /><p>Loading architecture map…</p></div>
        </main>
      </>
    );
  }

  return (
    <>
      <BrandHeader />
      <main className="overview-page">
        <div className="container architecture-page-shell">
          <div className="page-header architecture-page-header">
            <div>
              <div className="page-kicker">Architecture · {data.report.primary.architecture}</div>
              <h1>How the codebase is layered.</h1>
              <p className="page-lede">{data.report.summary}</p>
            </div>
            <div className="page-actions"><Link href={`/analyze/${encodeURIComponent(id)}/overview`} className="text-link">Back to overview</Link></div>
          </div>
          <ArchitectureGraph data={data} analysisId={id} />
        </div>
      </main>
    </>
  );
}
