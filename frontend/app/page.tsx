"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandHeader } from "../components/BrandHeader";
import { createAnalysis, ApiError } from "../lib/api/client";

/**
 * Mirrors the backend URL rules (owner/repository only, HTTPS, no query or fragment) so the form
 * rejects the same inputs the API does instead of surfacing a server error.
 */
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
      <BrandHeader />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="container hero-grid">
            <div>
              <div className="eyebrow">Repository intelligence</div>
              <h1 id="hero-title">Understand your codebase instantly.</h1>
              <p className="hero-copy">RepoLens traces the structure of a repository from the files it contains to the dependencies that connect them.</p>
              <form className="analyze-form" onSubmit={submit} noValidate>
                <label className="input-label" htmlFor="repository-url">GitHub repository URL</label>
                <div className="input-row">
                  <input
                    id="repository-url"
                    name="repository-url"
                    className="repo-input mono"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://github.com/user/repository"
                    autoComplete="url"
                    inputMode="url"
                    aria-describedby={error ? "repository-url-error" : undefined}
                    aria-invalid={Boolean(error)}
                    disabled={submitting}
                  />
                  <button className="primary-button" type="submit" disabled={submitting}>
                    {submitting ? "Analyzing…" : "Analyze Repository"}
                  </button>
                </div>
                {error ? <p id="repository-url-error" className="form-error" role="alert">{error}</p> : null}
              </form>
            </div>
            <aside className="hero-note" aria-label="RepoLens description">
              <div className="mono" style={{ color: "var(--primary)", marginBottom: 12 }}>01 / INGEST</div>
              Secure repository intake.<br /><br />
              <div className="mono" style={{ color: "var(--primary)", marginBottom: 12 }}>02 / PARSE</div>
              AST-level source understanding.<br /><br />
              <div className="mono" style={{ color: "var(--primary)", marginBottom: 12 }}>03 / EXPLAIN</div>
              Dependency and architecture signals.
            </aside>
          </div>
        </section>
      </main>
    </>
  );
}
