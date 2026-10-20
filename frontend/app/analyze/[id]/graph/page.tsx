"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ApiError, getDependencyGraph, getOverview } from "../../../../lib/api/client";
import type { OverviewResponse } from "../../../../lib/api/types";
import type { DependencyGraphResult } from "../../../../lib/api/graph-types";
import { GraphWorkbench } from "../../../../components/GraphWorkbench";
import { BrandHeader } from "../../../../components/BrandHeader";
import { AnalysisNav } from "../../../../components/AnalysisNav";
import { analysisHref } from "../../../../lib/routes";

export default function DependencyGraphPage() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<DependencyGraphResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  useEffect(() => {
    let active = true;
    setData(null); setError(null); setOverview(null);
    getOverview(id).then(result => { if (active) setOverview(result); }).catch(() => {});
    getDependencyGraph(id).then(result => { if (active) setData(result); }).catch((caught: unknown) => { if (active) setError(caught instanceof ApiError ? caught.message : "Unable to load the dependency graph."); });
    return () => { active = false; };
  }, [id]);
  return <><BrandHeader /><main className="overview-page workbench-page"><div className="container"><header className="workbench-page-header"><div><span className="page-kicker">{overview ? `${overview.repository.owner}/${overview.repository.name} · ${overview.completeness.status} analysis` : `Repository intelligence / analysis ${id}`}</span><h1>Dependency graph</h1></div><Link className="text-link" href={analysisHref(id, "/overview")}>Return to overview</Link></header><AnalysisNav />
    {error ? <div className="error-block" role="alert"><h2>Graph unavailable.</h2><p>{error}</p></div> : !data ? <div className="loading-block" role="status"><div className="spinner" /><p>Loading dependency graph…</p></div> : <GraphWorkbench key={id} graph={data} analysisId={id} />}
  </div></main></>;
}
