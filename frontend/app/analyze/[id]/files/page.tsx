"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { BrandHeader } from "../../../../components/BrandHeader";
import { RepositoryExplorer } from "../../../../components/RepositoryExplorer";
import { ApiError, listFiles } from "../../../../lib/api/client";
import type { FileSummary } from "../../../../lib/api/file-types";

export default function FilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [files, setFiles] = useState<FileSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    listFiles(id)
      .then((value) => {
        if (active) setFiles(value);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError ? caught.message : "Unable to load repository files.");
      });
    return () => { active = false; };
  }, [id]);

  return (
    <>
      <BrandHeader />
      <main className="explorer-page">
        <div className="container">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link href={`/analyze/${encodeURIComponent(id)}/architecture`}>Architecture</Link>
            <span>/</span>
            <span>Modules</span>
          </nav>

          <div className="page-header explorer-header">
            <div>
              <div className="page-kicker">Repository explorer</div>
              <h1>Modules and files.</h1>
              <p className="page-lede">Move from architecture layers into the actual files and symbols that compose them.</p>
            </div>
            <div className="page-actions">
              <Link href={`/analyze/${encodeURIComponent(id)}/architecture`} className="text-link">Architecture map</Link>
              <Link href={`/analyze/${encodeURIComponent(id)}/overview`} className="text-link">Overview</Link>
            </div>
          </div>

          {error ? (
            <div className="error-panel" role="alert">
              <h2>Files unavailable</h2>
              <p>{error}</p>
            </div>
          ) : files ? (
            <RepositoryExplorer files={files} analysisId={id} />
          ) : (
            <div className="loading-block" role="status" aria-live="polite">
              <div className="spinner" aria-hidden="true" />
              <p>Loading repository files…</p>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
