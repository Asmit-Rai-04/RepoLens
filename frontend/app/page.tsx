"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createAnalysis, ApiError } from "../lib/api/client";
import styles from "./page.module.css";

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

function StructureField() {
  return (
    <div className={styles.landingStructure} aria-hidden="true">
      <div className={`${styles.structureCaption} ${styles.mono}`}>DEPENDENCY FIELD / LIVE MODEL</div>
      <svg className={styles.structureSvg} viewBox="0 0 620 390" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g className={styles.structureGridLines}>
          <path d="M40 72H570M40 195H570M40 318H570" />
          <path d="M104 38V350M310 38V350M516 38V350" />
        </g>
        <g className={styles.structureLinks}>
          <path d="M105 112L224 72L310 142L416 94L516 151L438 248L310 218L201 282L105 236L224 72" />
          <path d="M105 112L105 236M224 72L201 282M310 142L310 218M416 94L438 248M516 151L516 292" />
          <path d="M201 282L310 218L516 292" />
        </g>
        <g className={styles.structureNodes}>
          <circle cx="105" cy="112" r="5" /><circle cx="224" cy="72" r="5" />
          <circle cx="310" cy="142" r="7" /><circle cx="416" cy="94" r="5" />
          <circle cx="516" cy="151" r="5" /><circle cx="438" cy="248" r="6" />
          <circle cx="310" cy="218" r="5" /><circle cx="201" cy="282" r="5" />
          <circle cx="105" cy="236" r="5" /><circle cx="516" cy="292" r="5" />
        </g>
        <g className={`${styles.structureLabels} ${styles.mono}`}>
          <text x="78" y="96">ENTRY</text><text x="205" y="55">CORE</text>
          <text x="292" y="129">MODULE</text><text x="420" y="80">SERVICE</text>
          <text x="495" y="139">EDGE</text><text x="452" y="239">CYCLE</text>
        </g>
        <g className={`${styles.structureReadout} ${styles.mono}`}>
          <text x="40" y="366">NODES 10</text><text x="250" y="366">EDGES 12</text><text x="465" y="366">SCC 03</text>
        </g>
      </svg>
      <div className={`${styles.structureSideNote} ${styles.mono}`}><span>01</span> TRACE</div>
    </div>
  );
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
        <div className={styles.landingAtmosphere} aria-hidden="true" />

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

        <section className={styles.landingVisualZone}>
          <StructureField />
          <div className={styles.visualCapacity}>
            <span className={styles.mono}>ANALYZER CAPACITY</span>
            <strong className={styles.mono}>31K<span>+</span></strong>
            <p>source files stress-tested in the analyzer</p>
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
                placeholder="github.com/user/repository"
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
            <p id="command-help" className={`${styles.commandHelp} ${styles.mono}`}>AST <i>→</i> dependency graph <i>→</i> architecture signals</p>
          </form>

          <div className={styles.pipeline} aria-label="Analysis pipeline">
            <div className={styles.pipelineLine} aria-hidden="true"><span /><span /><span /></div>
            <div className={styles.pipelineStep}><b className={styles.mono}>01</b><strong>INGEST</strong><small>secure intake</small></div>
            <div className={styles.pipelineStep}><b className={styles.mono}>02</b><strong>PARSE</strong><small>AST structure</small></div>
            <div className={styles.pipelineStep}><b className={styles.mono}>03</b><strong>EXPLAIN</strong><small>graph + architecture</small></div>
            <div className={`${styles.pipelineNote} ${styles.mono}`}>REPOSITORY <span>→</span> STRUCTURAL MODEL <span>→</span> EXPLANATION</div>
          </div>
        </section>
      </main>
    </>
  );
}
