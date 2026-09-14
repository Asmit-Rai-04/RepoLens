# RepoLens

RepoLens is an interactive repository intelligence platform for understanding how a codebase actually works. Point it at a public GitHub repository and it downloads, parses, and analyzes the source statically — it never executes repository code.

The backend is built with FastAPI, Pydantic, Tree-sitter, and NetworkX. The frontend is a Next.js App Router application using React, TypeScript, React Flow, and Dagre.

## Architecture

Backend layers (`app/`):

- `services/` — GitHub client, streaming download, secure archive extraction, file discovery, analysis orchestration, in-memory analysis store
- `analyzers/` — language detection and Tree-sitter parsing into a repository intermediate representation
- `graph/` — NetworkX dependency graph, import resolution (internal/external/unresolved), cycles, SCCs, metrics
- `architecture/` — deterministic architecture detection (layered, MVC, service/repository, frontend/backend, monorepo, flat), layer classification, violation detection, framework signals
- `intelligence/` — health scoring and ranked engineering insights, derived only from the analysis result
- `api/` — REST endpoints; `schemas/` — typed request/response models

Frontend (`frontend/`): App Router pages for the landing page, analysis progress, overview, architecture, file explorer/inspector, dependency graph, and health/insights, with an API client, typed API models, and React Flow visualizations.

## Supported languages

Python, JavaScript, TypeScript, TSX, and Java are parsed with Tree-sitter. Other source files are discovered and counted but not parsed; parse failures on individual files never abort the analysis.

## How analysis works

1. **Ingest** — validate the GitHub URL, stream the archive download with size limits, extract safely (see Security model), discover source files, detect languages (extension-first, shebang fallback for extensionless files).
2. **Parse** — extract files, classes, functions, methods, interfaces, imports, and inheritance with location information.
3. **Build graph** — resolve imports where possible (Python packages/relative paths, JS/TS relative and index resolution, Java package-based), classify every dependency as internal, external, or unresolved, and compute cycles, SCCs, and importance metrics on the internal graph.
4. **Detect architecture** — classify layers from directory/symbol evidence, detect dependency-direction violations, and record the evidence behind every conclusion.
5. **Score and report** — compute the health score and produce ranked, deterministic insights with deep links into the relevant views.

## Large repositories and partial analysis

RepoLens is designed to analyze public GitHub repositories of varying sizes using resource-aware ingestion and graceful partial analysis when necessary. Repositories are not rejected merely for being large: vendored/generated content (`.git`, `node_modules`, build output, media, binaries) is excluded up front per the discovery rules, and analyzable source is prioritized — source first, then docs/config, then everything else — against configurable extraction budgets. Content that does not fit is skipped, recorded with a reason, and reported through the API and the overview UI.

Every analysis reports its completeness:

- **Complete** — all analyzable source was extracted (excluding only the standard ignored directories).
- **Partial** — some safe content was skipped to stay within the resource budgets; the overview shows what and why.
- **Rejected** — only for genuine security/resource ceilings (archive above the compressed ceiling, entry-count bombs, implausible compression, malformed archives), always with a typed, user-friendly error.

Security protections are unaffected: path traversal, absolute paths, links, special files, and decompression bombs are still rejected or skipped exactly as before; the budgets only decide how much of a *safe* archive is analyzed.

## Backend setup

```bash
python -m venv .venv
# Windows PowerShell: .venv\Scripts\Activate.ps1
# Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
```

Run:

```bash
uvicorn app.main:app --reload
```

Health endpoint: `GET /health`. Configuration is read from `.env` (copy `.env.example`); every variable is optional.

### Backend environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_NAME` | `RepoLens` | Service name |
| `APP_ENV` | `development` | Environment label |
| `LOG_LEVEL` | `INFO` | Log verbosity |
| `MAX_REPOSITORY_BYTES` | `104857600` | GitHub-reported size above which a repository is logged as oversized (metadata only; see partial analysis) |
| `MAX_ARCHIVE_BYTES` | `52428800` | Floor for the compressed-archive ceiling |
| `MAX_EXTRACTED_BYTES` | `262144000` | Entry-size sanity bound used by the compression-ratio guard |
| `MAX_EXTRACTED_FILES` | `200000` | Hard cap on archive entry count (bomb guard) |
| `MAX_SINGLE_FILE_BYTES` | `10485760` | Per-file extraction limit; larger files are skipped and reported |
| `DOWNLOAD_TIMEOUT_SECONDS` | `30` | Archive download timeout |
| `PARTIAL_EXTRACTED_BYTES_BUDGET` | `1073741824` | Pre-compression extraction budget; content beyond it is skipped and reported |
| `PARTIAL_EXTRACTED_FILES_BUDGET` | `150000` | Extraction file-count budget; content beyond it is skipped and reported |
| `GITHUB_API_BASE_URL` | `https://api.github.com` | GitHub API base |
| `GITHUB_TOKEN` | *(empty)* | Optional; only raises API rate limits |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated allowed browser origins |
| `MAX_RETAINED_ANALYSES` | `10` | Completed analyses kept (oldest evicted with their workspaces) |

## Frontend setup

```bash
cd frontend
npm install
npm run dev
```

Frontend environment variable: `NEXT_PUBLIC_API_URL` (default `http://localhost:8000/api`) — copy `frontend/.env.example` to `frontend/.env.local` to override.

### Frontend checks

```bash
npm test        # vitest unit/component tests
npm run typecheck
npm run build   # production build
```

## Testing (backend)

```bash
python -m pytest
```

On Windows, pass `--basetemp` pointing inside the project if the default temp location is restricted, e.g. `python -m pytest --basetemp=.pytest-tmp`. The suite covers URL validation, secure extraction (traversal, links, limits), language detection, Tree-sitter parsing, dependency resolution, cycles/SCCs, graph metrics, architecture detection and violations, health scoring, insights, and the analysis API lifecycle.

## Production build

```bash
# backend
uvicorn app.main:app --host 0.0.0.0 --port 8000

# frontend
cd frontend && npm run build && npm start
```

## API overview

```text
POST /api/analyze                        create an analysis from a GitHub URL
GET  /api/analyze/{id}                  analysis status, stages, typed errors
GET  /api/analyze/{id}/overview         repository summary and file tree
GET  /api/analyze/{id}/architecture     detected architecture, layers, evidence, violations
GET  /api/analyze/{id}/graph            dependency graph (internal/external/unresolved), cycles, SCCs
GET  /api/analyze/{id}/files            discovered source files
GET  /api/analyze/{id}/files/{path}     file detail: symbols, imports, resolution
GET  /api/analyze/{id}/source/{path}    raw source with line numbers
GET  /api/analyze/{id}/health           weighted health score and dimensions
GET  /api/analyze/{id}/insights         ranked deterministic findings with deep links
GET  /health                            liveness
```

Errors are typed and sanitized: invalid URLs, unknown analyses, missing files, and oversized/unavailable repositories return structured messages with appropriate status codes — never stack traces or server paths.

## Security model

RepoLens analyzes arbitrary public repositories without executing any of their code:

- GitHub URLs are validated against the GitHub host/path format before any request is made.
- Downloads are streamed with configurable time limits under a compressed-archive ceiling derived from the extraction budget (`max(MAX_ARCHIVE_BYTES, PARTIAL_EXTRACTED_BYTES_BUDGET / 4)`), shared by the downloader and the extractor.
- Archive extraction rejects path traversal, absolute paths, symlinks, hardlinks, and special files; it enforces an entry-count bomb guard, a compression-ratio sanity bound, and the per-file size limit. Link and special-file entries are skipped and reported, not written.
- Source paths on API endpoints are validated against the analysis's discovered file set.
- Responses never contain server filesystem paths, tokens, or internal exception details.
- The analysis store is in-memory; no repository content is persisted beyond the configured workspaces.

## Runtime note

The project intentionally uses an in-memory analysis store for the current release. Completed analysis data does not survive a backend process restart, and unauthenticated GitHub API access is subject to GitHub's rate limit (a token raises it).
