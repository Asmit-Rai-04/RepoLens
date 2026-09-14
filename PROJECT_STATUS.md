# RepoLens — Project Status

**State: feature-complete and verified.** See `README.md` for setup, API overview, security model, and limitations.

## What exists

- **Backend (`app/`, FastAPI + Pydantic + Tree-sitter + NetworkX)**
  - Secure ingestion: URL validation, streaming download, hardened archive extraction (traversal/symlink/limit enforcement), file discovery, language detection
  - Tree-sitter parsing for Python, JavaScript, TypeScript, TSX, and Java
  - Dependency graph with internal/external/unresolved resolution, cycles, SCCs, and graph metrics
  - Deterministic architecture detection with evidence, layer classification, and violation detection
  - Weighted health scoring (Parse 20 / Imports 20 / Cycles 20 / Architecture 25 / Coupling 15) and ranked deterministic insights
  - Async analysis lifecycle (`queued → ingesting → parsing → building_graph → detecting_architecture → completed/failed`) with typed, sanitized errors
- **Frontend (`frontend/`, Next.js App Router + React + TypeScript + @xyflow/react + Dagre)**
  - Landing page with URL submission, live progress polling, overview, architecture graph with layer inspector, file explorer and file inspector with source viewer, dependency graph with filters/search/cycle focus, health and insights with deep links

## Verification summary

- Backend: `python -m pytest` — all tests pass (163 passed, 1 skipped)
- Frontend: `npm test`, `npm run typecheck`, `npm run build` — all pass
- Live end-to-end verified in a real browser against multiple real public repositories (Python, JavaScript, TypeScript/TSX, Java) across desktop and mobile viewports (1920/1366/1024/768/390/375), with clean console output
- Error paths (invalid URL, nonexistent repository, unknown analysis ID, invalid file path) verified live
- Cycle enumeration is bounded so large strongly-connected groups cannot stall the analysis; truncation is surfaced in the API and UI

## Runtime notes

- In-memory analysis store: analyses do not survive a backend restart; the oldest completed analyses are evicted beyond `MAX_RETAINED_ANALYSES`
- Unauthenticated GitHub API access is rate-limited by GitHub; set `GITHUB_TOKEN` to raise it
