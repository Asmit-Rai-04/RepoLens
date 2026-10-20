"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createAnalysis, ApiError } from "../lib/api/client";
import styles from "./page.module.css";
import { GraphWorkbench } from "../components/GraphWorkbench";
import { demoGraph } from "../lib/graph/demo";

function isGithubRepositoryUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "github.com") return false;
    if (url.search || url.hash || url.port || url.username || url.password) return false;
    const segments = url.pathname.replace(/\/+$/, "").split("/").filter(Boolean);
    if (segments.length !== 2) return false;
    return /^[A-Za-z0-9_.-]+$/.test(segments[0]) && /^[A-Za-z0-9_.-]+(?:\.git)?$/.test(segments[1]);
  } catch {
    return false;
  }
}

export default function HomePage() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!isGithubRepositoryUrl(trimmed)) {
      setError("Enter a valid public GitHub repository URL.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const response = await createAnalysis(trimmed);
      router.push(`/analyze/${response.analysis_id}`);
    } catch (caught) {
      setSubmitting(false);
      setError(caught instanceof ApiError ? caught.message : "Unable to start repository analysis.");
    }
  }

  return (
    <>
      <header className={styles.siteHeader}>
        <a href="/" className={styles.siteBrand} aria-label="RepoLens home">
          <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
          <span className={styles.brandName}>RepoLens</span>
        </a>
        <span className={`${styles.headerCenter} ${styles.mono}`}>RL / STATIC ANALYSIS</span>
        <span className={`${styles.headerRight} ${styles.mono}`}>PUBLIC REPOSITORIES <b>·</b> NO EXECUTION</span>
      </header>
      <main className={styles.landingShell}>
        <div className={styles.landingGrid} aria-hidden="true" />
        <div className={styles.landingScanlines} aria-hidden="true" />


        <div className={`${styles.landingCoordinate} ${styles.mono}`}>00.00 / REPOSITORY ENTRY</div>
        <div className={`${styles.landingTopStatus} ${styles.mono}`}>PUBLIC REPOSITORIES <span>·</span> NO EXECUTION</div>

        <section className={styles.landingTitleZone} aria-labelledby="hero-title">
          <div className={styles.eyebrow}><span className={styles.accentRule} />REPOSITORY INTELLIGENCE</div>
          <h1 id="hero-title">
            <span>Read the</span>
            <span className={styles.titleMono}>shape</span>
            <span className={styles.titleLast}>of a <em>codebase.</em></span>
          </h1>
          <p className={styles.heroCopy}>
            See the structure a repository hides in plain sight — files, imports, cycles,
            modules and architecture — without executing its code.
          </p>
          <div className={`${styles.heroTags} ${styles.mono}`}>
            <span>STATIC ANALYSIS</span><span>NO EXECUTION</span><span>TRACEABLE OUTPUT</span>
          </div>
        </section>

        <section className={styles.landingCommandZone} aria-labelledby="command-title">
          <div className={styles.commandHeading}>
            <div>
              <span className={`${styles.sectionKicker} ${styles.mono}`}>ANALYSIS INPUT</span>
              <h2 id="command-title">Point RepoLens at a repository.</h2>
            </div>
            <span className={`${styles.commandIndex} ${styles.mono}`}>CMD_01</span>
          </div>

          <form className={styles.commandForm} onSubmit={submit} noValidate>
            <label htmlFor="repository-url" className={styles.srOnly}>GitHub repository URL</label>
            <div className={styles.terminalField}>
              <span className={`${styles.terminalPrefix} ${styles.mono}`}>$ inspect</span>
              <input
                id="repository-url"
                name="repository-url"
                className={`${styles.repoInput} ${styles.mono}`}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                autoComplete="url"
                inputMode="url"
                aria-describedby={error ? "repository-url-error" : "command-help"}
                aria-invalid={Boolean(error)}
                disabled={submitting}
              />
              <button className={styles.commandSubmit} type="submit" disabled={submitting}>
                <span>{submitting ? "RUNNING" : "TRACE REPOSITORY"}</span><span>↗</span>
              </button>
            </div>
            {error ? <p id="repository-url-error" className={`${styles.formError} ${styles.mono}`} role="alert">ERR / {error}</p> : null}
            <p id="command-help" className={`${styles.commandHelp} ${styles.mono}`}>Accepted: https://github.com/owner/repository · Live analysis may take time.</p>
            {submitting ? <p role="status" className={styles.commandHelp}>Submitting repository to the analyzer…</p> : null}
          </form>
          <div className={styles.examples}><span>Live examples:</span>{["pallets/flask", "encode/httpx"].map(repo => <button key={repo} type="button" disabled={submitting} onClick={() => { setUrl(`https://github.com/${repo}`); setError(null); document.getElementById("repository-url")?.focus(); }}>{repo}</button>)}<span>Fill the input, then trace.</span></div>

          <div className={styles.pipeline} aria-label="Analysis pipeline">
            <div className={styles.pipelineLine} aria-hidden="true"><span /><span /><span /></div>
            <div className={styles.pipelineStep}><b className={styles.mono}>01</b><strong>INGEST</strong><small>secure intake</small></div>
            <div className={styles.pipelineStep}><b className={styles.mono}>02</b><strong>PARSE</strong><small>AST structure</small></div>
            <div className={styles.pipelineStep}><b className={styles.mono}>03</b><strong>EXPLAIN</strong><small>graph + architecture</small></div>
            <div className={`${styles.pipelineNote} ${styles.mono}`}>REPOSITORY <span>→</span> STRUCTURAL MODEL <span>→</span> EXPLANATION</div>
          </div>
        </section>
        <section className={styles.landingDemoZone} aria-label="Instant local demo"><GraphWorkbench graph={demoGraph} demo /></section>
      </main>
    </>
  );
}
