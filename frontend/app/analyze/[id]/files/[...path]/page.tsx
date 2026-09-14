"use client";

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BrandHeader } from "../../../../../components/BrandHeader";
import { ApiError, getFile, getSource } from "../../../../../lib/api/client";
import type { FileDetailResponse, SourceResponse, SymbolInfo } from "../../../../../lib/api/file-types";
import { analysisHref, fileHref } from "../../../../../lib/routes";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function selectedSymbol(symbols: SymbolInfo[], name: string | null): SymbolInfo | null {
  if (!name) return null;
  return symbols.find((symbol) => symbol.name === name) ?? null;
}

export default function FilePage({ params }: { params: Promise<{ id: string; path: string[] }> }) {
  const { id, path } = use(params);
  const filePath = path.join("/");
  const searchParams = useSearchParams();
  const symbolName = searchParams.get("symbol");
  const [detail, setDetail] = useState<FileDetailResponse | null>(null);
  const [source, setSource] = useState<SourceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    setError(null);
    Promise.all([getFile(id, filePath), getSource(id, filePath)])
      .then(([fileDetail, fileSource]) => {
        if (!active) return;
        setDetail(fileDetail);
        setSource(fileSource);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof ApiError ? caught.message : "Unable to load this file.");
      });
    return () => { active = false; };
  }, [id, filePath]);

  const selected = useMemo(() => selectedSymbol(detail?.source_file.symbols ?? [], symbolName), [detail, symbolName]);
  const lines = source?.content.split("\n") ?? [];

  async function copySource() {
    if (!source) return;
    try {
      await navigator.clipboard.writeText(source.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <>
      <BrandHeader />
      <main className="file-page">
        <div className="container">
          <nav className="breadcrumb" aria-label="Breadcrumb">
            <Link href={analysisHref(id, "/architecture")}>Architecture</Link>
            <span>/</span>
            <Link href={analysisHref(id, "/files")}>Modules</Link>
            <span>/</span>
            <span>Files</span>
            <span>/</span>
            <span aria-current="page">{filePath}</span>
          </nav>

          {error ? (
            <div className="error-panel" role="alert">
              <h2>File unavailable</h2>
              <p>{error}</p>
              <p style={{ marginTop: 18 }}><Link href={analysisHref(id, "/files")} className="text-link">Back to files</Link></p>
            </div>
          ) : !detail || !source ? (
            <div className="loading-block" role="status" aria-live="polite">
              <div className="spinner" aria-hidden="true" />
              <p>Loading file analysis…</p>
            </div>
          ) : (
            <>
              <div className="file-page-header">
                <div>
                  <div className="page-kicker">File inspector</div>
                  <h1 className="file-path-title"><code>{detail.source_file.path}</code></h1>
                  <div className="file-meta-line">
                    <span>{detail.source_file.language?.toUpperCase() ?? "UNKNOWN"}</span>
                    <span>{formatBytes(detail.source_file.size_bytes)}</span>
                    <span className={`parse-badge parse-${detail.source_file.parse_status}`}>{detail.source_file.parse_status}</span>
                    <span>{detail.source_file.symbols.length} symbols</span>
                    <span>{detail.source_file.imports.length} imports</span>
                    {detail.source_file.package_name ? <span className="mono">{detail.source_file.package_name}</span> : null}
                    {detail.layer ? <span className="layer-pill">{detail.layer}</span> : null}
                  </div>
                </div>
                <div className="file-actions">
                  <Link href={analysisHref(id, "/files")} className="text-link">All files</Link>
                  <button className="secondary-button compact-button" type="button" onClick={copySource}>{copied ? "Copied" : "Copy source"}</button>
                </div>
              </div>

              <section className="file-detail-grid">
                <aside className="file-inspector-panel" aria-labelledby="symbols-heading">
                  <div className="section-kicker">Symbols</div>
                  <h2 id="symbols-heading">Source symbols</h2>
                  {detail.source_file.symbols.length === 0 ? <div className="inspector-empty">No symbols were extracted.</div> : null}
                  <ul className="symbol-list">
                    {detail.source_file.symbols.map((symbol) => (
                      <li key={`${symbol.name}-${symbol.line_start}-${symbol.column_start}`}>
                        <Link
                          href={fileHref(id, filePath, { symbol: symbol.name })}
                          className={`symbol-row${selected?.name === symbol.name && selected.line_start === symbol.line_start ? " selected" : ""}`}
                          aria-current={selected?.name === symbol.name && selected.line_start === symbol.line_start ? "true" : undefined}
                        >
                          <span>
                            <strong>{symbol.name}</strong>
                            <small>{symbol.kind}{symbol.parent ? ` · ${symbol.parent}` : ""}</small>
                          </span>
                          <code>{symbol.line_start}–{symbol.line_end}</code>
                        </Link>
                      </li>
                    ))}
                  </ul>

                  <div className="inspector-block">
                    <div className="section-kicker">Imports</div>
                    <ImportGroup label="Resolved" items={detail.resolved_imports} analysisId={id} />
                    <ImportGroup label="External" items={detail.external_imports} analysisId={id} />
                    <ImportGroup label="Unresolved" items={detail.unresolved_imports} analysisId={id} />
                  </div>

                  <div className="inspector-block">
                    <div className="section-kicker">Inheritance</div>
                    {detail.source_file.inheritance.length === 0 ? <div className="inspector-empty small-empty">No inheritance relationships were extracted.</div> : (
                      <div className="inheritance-list">
                        {detail.source_file.inheritance.map((item) => <div className="inheritance-row" key={`${item.child}-${item.parent}-${item.line_start}`}><strong>{item.child}</strong><span>{item.relation}</span><strong>{item.parent}</strong></div>)}
                      </div>
                    )}
                  </div>
                </aside>

                <section className="source-panel" aria-labelledby="source-heading">
                  <div className="source-panel-header">
                    <div>
                      <div className="section-kicker">Source</div>
                      <h2 id="source-heading">{selected ? `${selected.name} · lines ${selected.line_start}–${selected.line_end}` : "Repository source"}</h2>
                    </div>
                    <span className="technical-count">{lines.length} lines</span>
                  </div>
                  {detail.source_file.parse_error ? <div className="parse-warning">{detail.source_file.parse_error}</div> : null}
                  <div className="source-viewer" role="region" aria-label={`Source code for ${filePath}`}>
                    {lines.map((line, index) => {
                      const lineNumber = index + 1;
                      const highlighted = Boolean(selected && lineNumber >= selected.line_start && lineNumber <= selected.line_end);
                      return (
                        <div className={`source-line${highlighted ? " highlighted" : ""}`} id={`line-${lineNumber}`} key={lineNumber}>
                          <span className="source-line-number" aria-hidden="true">{lineNumber}</span>
                          <code>{line || " "}</code>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </section>
            </>
          )}
        </div>
      </main>
    </>
  );
}

function ImportGroup({ label, items, analysisId }: { label: string; items: FileDetailResponse["resolved_imports"]; analysisId: string }) {
  return (
    <div className="import-group">
      <div className="inspector-label">{label}</div>
      {items.length === 0 ? <div className="import-empty">None</div> : items.map((item, index) => {
        const targetFile = item.target_file;
        return (
          <div className="import-row" key={`${item.module ?? item.target ?? "import"}-${index}`}>
            <div>
              <code>{item.module ?? item.target ?? "unknown"}</code>
              <small>{item.kind ?? "import"}{item.line_start ? ` · line ${item.line_start}` : ""}</small>
            </div>
            {label === "Resolved" && targetFile ? <Link className="import-target" href={fileHref(analysisId, targetFile)}>Open file →</Link> : null}
          </div>
        );
      })}
    </div>
  );
}
