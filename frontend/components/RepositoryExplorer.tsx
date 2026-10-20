"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { FileSummary } from "../lib/api/file-types";
import { fileHref, graphHref } from "../lib/routes";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function displayLanguage(language: string | null): string {
  return language ? language.toUpperCase() : "UNKNOWN";
}

export function RepositoryExplorer({ files, analysisId }: { files: FileSummary[]; analysisId: string }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => files.filter(file => `${file.path} ${file.language ?? ""} ${file.layer ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())), [files, query]);
  const grouped = new Map<string, FileSummary[]>();
  visible.forEach((file) => {
    const key = file.layer ?? "Unclassified";
    const items = grouped.get(key) ?? [];
    items.push(file);
    grouped.set(key, items);
  });

  const layers = Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <section className="explorer-section" aria-labelledby="modules-heading">
      <div className="section-heading-row">
        <div>
          <div className="section-kicker">Modules</div>
          <h2 id="modules-heading">Repository files</h2>
        </div>
        <div className="technical-count" role="status">{visible.length} / {files.length} files</div>
      </div>

      <label className="file-explorer-search">Search repository files<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Path, language, or architecture layer" /></label>
      {!visible.length ? <p role="status">No matching files.</p> : null}
      <div className="module-groups">
        {layers.map(([layer, items]) => (
          <details open className="module-group" key={layer} aria-labelledby={`module-${layer}`}>
            <summary className="module-group-header">
              <h3 id={`module-${layer}`}>{layer}</h3>
              <span>{items.length} files</span>
            </summary>
            <ul className="file-table">
              {items.sort((a, b) => a.path.localeCompare(b.path)).map((file) => (
                <li key={file.path}>
                  <Link href={fileHref(analysisId, file.path)} className="file-row">
                    <span className="file-main">
                      <code>{file.path}</code>
                      <span className={`parse-badge parse-${file.parse_status}`}>{file.parse_status}</span>
                    </span>
                    <span className="file-meta">
                      <span>{displayLanguage(file.language)}</span>
                      <span>{file.symbol_count} symbols</span>
                      <span>{file.import_count} imports</span>
                      <span>{formatBytes(file.size_bytes)}</span>
                    </span>
                  </Link>
                  <Link href={graphHref(analysisId, { file: file.path, focus: "focus" })} className="file-graph-link">Dependencies →</Link>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
