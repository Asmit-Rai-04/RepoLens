# RepoLens frontend and graph workbench — local review

Review date: 14 October 2026. Status: implemented and validated locally; awaiting explicit publishing approval. No changes have been pushed, no pull request has been opened, and no deployment or remote repository settings have been changed.

## Baseline and scope

The official baseline is `Asmit-Rai-04/RepoLens` GitHub `main`, commit `08d119e93692243e153b0b66f5f9e96834295cb8` (`feat: unify RepoLens frontend design`). The uploaded attachment contained the specification, not an alternate source tree. The initial workspace was empty; implementation uses an isolated clone in `review-baseline` on local branch `codex/graph-workbench`. There was no uploaded implementation to overwrite or reconcile. The latest remote state will be fetched again after approval, before publication.

The inspected application uses Next.js App Router, React, TypeScript, React Flow and Dagre. Python/FastAPI lives in the root `app/` directory. Existing landing, polling, overview, architecture, graph, files, source and insights routes remain available. No dependencies, environment files, deployment configuration, backend files or API contracts were changed. `ArchitectureGraph.tsx` remains unchanged.

## Before and after

| Area | Baseline | Implemented experience |
| --- | --- | --- |
| Landing | Decorative static graph and repository submission | Shared interactive graph beside the submission form on desktop, explicitly fictional offline demo, selectable files, dependency focus, cycle and impact actions |
| Initial repository graph | File-focused canvas difficult to inspect at scale | Deterministic directory-group overview; expand groups into files; breadcrumbs and return/reset controls |
| Investigation | Filters and basic selection | Searchable explorer, inspector, focus direction/depth, isolate, potential impact paths, reported cycle navigation and source links |
| Layout | Expensive layout intertwined with presentation | Geometry memoized separately from selection; sparse Dagre layouts and bounded deterministic SCC-aware grid fallback for dense or large cyclic views |
| Navigation | Existing cross-page links | Preserved links plus source-to-graph and per-file dependency links; URL-encoded investigation context and browser back/forward restoration |
| Files | Existing repository file listing | Path/language/layer search, counts and collapsible layer sections |
| Shared design | Existing dark/vermilion identity | Consistent typography tokens, visible focus, restrained state transitions, wider graph workspace and deliberately stacked mobile panels |

Existing overview findings, architecture semantics, insight calculations and actual progress stages were reused. These pages receive shared navigation/style refinements rather than replacements of their analysis logic.

## Implemented features and how they work

- **A — Progressive exploration:** live graphs start with directory groups derived from actual paths. Selecting a group expands its files. Repository/all-files breadcrumbs and reset return to the overview. External and unresolved entities are separately grouped. Counts distinguish displayed entities, current view and complete dataset. Canvas pages hold 100 entities, with selected context pinned when necessary; pagination and complete-dataset search preserve access to all entities.
- **B — Dependency spotlight:** selecting a file highlights its direct neighborhood. Focus supports imports, importers or both, with depth 1, 2 or all. Unrelated elements dim; isolate bounds the canvas to the selected neighborhood. Inspector counts are unique endpoint counts even when multiple import edges share endpoints. Arrows consistently point from importing source to imported dependency, with source evidence where supplied.
- **C — Layouts:** hierarchical and compact flow are real layout options. Dagre handles sparse views. Dense views or views with SCCs larger than 12 files use deterministic SCC-condensed placement and straight edges. Explicit node dimensions and vertical mobile handles avoid geometry mismatches. Selection does not rerun layout. Fit selection, fit view, pan and zoom remain available.
- **D — Dedicated workspace:** explorer, canvas, inspector, toolbar, breadcrumbs, visible counts, minimap toggle and expanded workspace. Mobile uses stacked panels and vertical flow. Expanded mode manages focus, background inertness, Escape, scroll restoration and return focus.
- **E — Change impact:** reverse-adjacency breadth-first traversal identifies potentially affected dependents, cycle-safely. Inspector distinguishes direct and transitive dependents, shows dependency distance and shortest evidence paths, and provides source links. Depth changes actually update the graph. Language describes structural possibility rather than guaranteed runtime failure.
- **F — Cycle investigator:** actual backend-reported cycles have selectable chains, previous/next navigation and focused views. Only the chosen cycle is forwarded to cycle-edge styling. SCCs are presented separately; backend truncation is explained. Cycle edges follow actual source-to-dependency direction. Existing cycle links are supported.
- **G — Search and palette:** Ctrl/Cmd+K or the Search button opens a native modal command palette with arrow/Enter navigation, Escape and focus restoration. Categories cover files, directory groups, actual backend-ranked important files, cycles, external and unresolved entities. Search uses the complete indexed dataset. Typed entity kinds prevent files whose names resemble command IDs from being mistaken for commands.
- **J — Performance:** cached incoming/outgoing indexes; visited-set traversal; memoized aggregation, filtering and node rendering; stable evidence-derived edge IDs; geometry independent of selection; viewport-aware rendering; progressive bounded views; simplified dense edges; no perpetual edge animation; constant-time minimap color lookup.
- **Living demo:** bundled Parcel v1 is clearly labeled `DEMO DATA — NOT A LIVE REPOSITORY ANALYSIS`. It contains 10 files, 14 real fixture relationships, four groups and a consistent two-file cycle. Architecture, dependency, cycle, impact and reset buttons change the actual visualization. The demo makes no backend requests or claims about a real repository.
- **Submission:** terminal-inspired labeled input retains prior GitHub URL validation, Enter submission, API call, error handling and routing. Loading feedback, accepted-format guidance and public example URL-fill buttons distinguish actual analysis from the instant demo.
- **Symbols:** the existing source inspector exposes extracted symbols through the graph's file-inspector link. No unsupported symbol call graph or global symbol index is fabricated.
- **URL compatibility:** file/module, exploration level, filter, focus, direction, depth, layout and cycle selection can be restored from URLs. Existing comma-separated cycle links are read; new links use compact `cycleIndex` values. Browser history restores investigation state.
- **Accessibility:** semantic buttons/links, searchable non-canvas navigation, labeled inputs, visible focus, direction text, dialog keyboard navigation, expanded-workspace focus containment and reduced-motion support. No color-only requirement for essential graph navigation.

## Implementation boundaries

`GraphWorkbench` owns exploration and investigation state and coordinates independent toolbar, explorer, inspector, palette and canvas components. Both landing and live analysis reuse it. `workbench.ts` supplies pure indexes, grouping, aggregation, search, traversal, filters and URL state. `dense-layout.ts` supplies deterministic expensive-view placement. `DependencyGraph.tsx` keeps reusable canvas geometry separate from selected/focused presentation. The API wrapper page handles real loading/errors and optional existing overview data for repository identity and completeness.

No new backend endpoints, request/response shapes, ranking formulas, analysis scores or source modifications were introduced. The graph page additionally reads the existing overview endpoint; failure of that optional read does not prevent graph rendering.

## Validation

Commands were run from the isolated clone (frontend commands inside `frontend/`).

| Check | Command / method | Result |
| --- | --- | --- |
| Dependency install | `npm ci`; Python virtual environment with existing requirements | Successful; no manifest/lockfile changes |
| Frontend unit/interaction tests | `npm test` | **51 passed across 19 files**; baseline contained 31 tests across 15 files |
| TypeScript | `npm run typecheck` | Passed |
| Production build | `npm run build` | Passed; all existing application routes retained |
| Backend regression | `.\.venv\Scripts\python.exe -m pytest --basetemp=.pytest-tmp-workbench --tb=short` | **168 passed, 1 skipped**; Windows symlink privilege skip; one inherited Starlette/httpx deprecation warning |
| Whitespace | `git diff --check` | Passed |
| Controlled performance | `npm exec -- vitest run test/graph-performance.test.ts` | Passed; eight size/density scenarios |
| Actual browser automation | `node scripts/browser-check.cjs` with bundled Playwright on `NODE_PATH`, installed Chrome and local production frontend | **18 checks passed**, eight stress scenarios, no page JavaScript errors |
| Responsive/visual | Browser checks and screenshot inspection | 375, 768, 1024, 1440 and 1920px; landing, graph and shared pages; no horizontal page overflow |
| Live end-to-end | Actual landing submission to unchanged local backend, public RepoLens GitHub download/static analysis, polling, overview, graph, source inspector | Passed: 127 total files, 112 source files, 171 graph entities, 555 edges, 0 reported cycles; no page errors. Nonempty `app/main.py` source and extracted symbol verified |
| Lint | No baseline lint script or configuration exists | **Unavailable; not claimed as passed** |

Browser coverage includes demo selection/reset, expand/collapse, keyboard palette, layout switching, focus/isolate/depth/reset, filters, legacy/new cycle and file links, back/forward, files search, source symbols, insights-to-cycle and architecture-to-graph navigation, invalid/valid submission contracts, polling flow, pan/zoom, reduced motion and expanded-mode keyboard containment. Unit tests cover adjacency direction, cycles, disconnected/empty graphs, grouping, aggregation, filters, stable edge identities, typed search actions, URL validation/restoration and geometry stability.

Fixture browser checks intercept API responses for determinism. The separate live smoke test uses the actual unchanged local backend and actual public GitHub repository. Neither runs code from the analyzed repository.

## Measured performance

Algorithm comparison uses the retained GitHub-main neighborhood/module functions versus the new implementation on deterministic synthetic graphs. Values are milliseconds: median of 25 samples after 5 warmups, Node/V8. Selection columns measure **100 direct-neighborhood operations per sample**; the new index is constructed once, and its cost is listed separately. These are algorithm measurements, not browser interaction latency.

| Nodes / edges | Index build | Selection before → after (100 operations) | Module derivation before → after | Search | Full reverse impact | Bounded grid layout |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 / 60 | 0.0436 | 0.0485 → 0.1993 | 0.1323 → 0.0472 | 0.0045 | 0.0138 | 0.0704 |
| 20 / 320 | 0.0790 | 0.3208 → 0.4881 | 0.3744 → 0.1931 | 0.0037 | 0.0300 | 0.1405 |
| 100 / 300 | 0.1856 | 0.1434 → 0.1437 | 0.3851 → 0.1261 | 0.0119 | 0.0145 | 0.1824 |
| 100 / 1,600 | 0.3426 | 0.7100 → 0.2110 | 1.3079 → 0.5941 | 0.0062 | 0.0343 | 0.3466 |
| 500 / 1,500 | 0.8030 | 0.5376 → 0.0470 | 1.5691 → 0.6073 | 0.0258 | 0.0751 | 0.3317 |
| 500 / 8,000 | 1.0198 | 2.8507 → 0.2078 | 4.4203 → 2.7846 | 0.0247 | 0.1558 | 0.5494 |
| 1,500 / 4,500 | 1.6093 | 1.3794 → 0.0410 | 4.2585 → 1.8254 | 0.0747 | 0.2400 | 0.1599 |
| 1,500 / 24,000 | 2.4096 | 8.3952 → 0.2001 | 12.7559 → 8.6767 | 0.0749 | 0.4820 | 0.5306 |

The largest dense case improves direct-neighborhood computation by approximately **42×**. Tiny graphs show indexed traversal overhead rather than a speedup; this is preserved in the results.

The production browser harness also records single local Chrome samples. Ready means navigation until the initial graph is visible; search/selection combines both actions and automation waits. Memory is a browser used-heap snapshot, not a leak test. Rendered DOM nodes are viewport-visible after selection, not the complete analyzed dataset.

| Nodes / edges | Initial ready ms | Search + selection ms | Rendered node DOM | Used heap MB (decimal) |
| --- | ---: | ---: | ---: | ---: |
| 20 / 60 | 147.0 | 101.0 | 20 | 25.1 |
| 20 / 320 | 146.2 | 145.8 | 16 | 32.2 |
| 100 / 300 | 159.1 | 243.6 | 100 | 43.5 |
| 100 / 1,600 | 218.0 | 451.5 | 4 | 62.9 |
| 500 / 1,500 | 176.8 | 262.5 | 5 | 41.9 |
| 500 / 8,000 | 205.9 | 138.5 | 3 | 54.8 |
| 1,500 / 4,500 | 193.4 | 208.1 | 5 | 76.7 |
| 1,500 / 24,000 | 357.4 | 157.6 | 3 | 47.3 |

No original-main browser timing baseline, FPS trace, sustained heap/leak profile or production-network latency comparison was captured. Do not interpret these samples as universal latency guarantees. Raw measurements and screenshots are saved locally under ignored `.verification/`.

## Complete intended file manifest

Paths below are relative to the isolated repository root. **14 modified files and 14 new files**, including this report. No generated build artifacts, dependencies, virtual environment or private verification data are intended for publication.

Modified:

1. `frontend/app/analyze/[id]/files/[...path]/page.tsx` — dependency investigation link from source inspector.
2. `frontend/app/analyze/[id]/graph/page.tsx` — live API wrapper and shared workbench integration.
3. `frontend/app/analyze/[id]/overview/page.tsx` — actual repository identity heading.
4. `frontend/app/globals.css` — shared typography, graph/panel states, responsive/focus/reduced-motion styles.
5. `frontend/app/page.module.css` — responsive living-demo landing composition and command input.
6. `frontend/app/page.tsx` — interactive local demo and preserved real submission.
7. `frontend/components/AnalysisNav.tsx` — analyze-another navigation.
8. `frontend/components/DependencyGraph.tsx` — memoized geometry, layout strategy, directed handles, fitting and bounded rendering.
9. `frontend/components/Overview.tsx` — correct nested heading hierarchy.
10. `frontend/components/RepositoryExplorer.tsx` — search, counts, collapsible sections and graph links.
11. `frontend/lib/graph/dependency-graph.ts` — stable semantic edge IDs.
12. `frontend/lib/graph/layout.ts` — directionally correct cycle-edge weighting.
13. `frontend/test/dependency-graph-ui.test.tsx` — preserved assertions across split component boundaries.
14. `frontend/test/setup.ts` — browser media-query support with safe non-DOM guard.

New:

1. `docs/frontend-workbench-review.md` — this implementation and approval report.
2. `frontend/components/GraphCommandPalette.tsx` — accessible indexed command/search dialog.
3. `frontend/components/GraphExplorer.tsx` — searchable navigation and pagination.
4. `frontend/components/GraphInspector.tsx` — metadata, evidence, impact, cycles and ranking.
5. `frontend/components/GraphToolbar.tsx` — filters, layouts and panel controls.
6. `frontend/components/GraphWorkbench.tsx` — shared state and investigation orchestration.
7. `frontend/lib/graph/demo.ts` — versioned fictional offline demo.
8. `frontend/lib/graph/dense-layout.ts` — deterministic SCC-aware bounded placement.
9. `frontend/lib/graph/workbench.ts` — pure indexes, traversal, grouping, search, filters and URL state.
10. `frontend/scripts/browser-check.cjs` — repeatable production-browser verification and stress harness; Playwright provided externally via `NODE_PATH`.
11. `frontend/test/graph-performance.test.ts` — algorithm comparisons and large fixtures.
12. `frontend/test/layout-stability.test.tsx` — selection geometry stability and expensive-view fallback.
13. `frontend/test/workbench-interaction.test.tsx` — workbench interaction and state correctness.
14. `frontend/test/workbench.test.ts` — graph foundations and URL/search correctness.

## Known limitations and remaining risks

- No failing behavior was observed in the executed checks. This is not a guarantee that every browser, graph topology or assistive technology has been tested.
- Directory groups are deterministic navigation aids; they are not newly inferred architecture boundaries. The protected architecture visualization remains the source for backend architecture findings.
- Symbol inspection reuses the existing source API. Symbol-to-symbol edges and global symbol search are unsupported by the current graph API and were not invented.
- The canvas is intentionally bounded to 100 entities per page, plus pinned selected context. Only edges with both endpoints in the current subset render. Cross-page relationships remain discoverable through full indexes, search and inspector evidence. Dense graphs can still have crossings and small labels when fully fitted; expand/focus/zoom is the intended investigation flow.
- Impact detail paths are bounded to the first 100 displayed entries; complete traversed membership remains accessible in the explorer. The palette displays up to 40 matching results at once; refine the search for additional matches.
- Backend cycle truncation and static-analysis incompleteness are retained and disclosed. SCCs are not treated as exhaustive simple-cycle lists; impact is structural possibility.
- No dedicated lint configuration exists. Formal screen-reader/contrast audit, prolonged memory leak testing, browser FPS profiling, 10,000+ node stress and production deployment smoke tests remain unperformed.
- The unchanged dependency baseline reports **5 npm audit advisories**: Next.js critical; sharp and source-map-js high; Vitest and @vitest/mocker moderate. No unrelated dependency upgrades were mixed into this feature. These advisories should be addressed before a production rollout; local functional checks do not resolve them.
- The backend test suite retains one Windows symlink skip and one Starlette/httpx deprecation warning.

## Exact proposed publication operations — only after approval

The local feature branch already exists. Nothing below has been executed as a publishing step. From the isolated clone:

```powershell
git fetch origin
git log --oneline HEAD..origin/main
git diff --name-status HEAD..origin/main
git merge --no-edit origin/main
```

Inspect upstream changes first. If the merge cannot safely proceed with the local working tree, preserve the intended changes with a local commit before reconciliation. Resolve conflicts without discarding either version. Substantial upstream changes or conflicts require another review and your confirmation before publication. Re-run relevant checks after reconciliation.

Use the reviewed exact manifest stored locally in `.verification/intended-files.txt` for staging; brackets in route names are treated literally:

```powershell
git --literal-pathspecs add --pathspec-from-file=.verification/intended-files.txt
git diff --cached --check
git diff --cached --stat
git commit -m "feat: build interactive RepoLens dependency workbench"
git push -u origin codex/graph-workbench
```

Then open a pull request through the GitHub connector with base `main`, head `codex/graph-workbench`, title `feat: build interactive RepoLens dependency workbench`, and a description summarizing behavior, validation and known limits. Attach and provide its URL, branch name and commit hash. Do not merge the PR, push to `main`, force-push, deploy or modify repository settings.

The implementation is ready for local review and the publishing approval checkpoint. Production deployment readiness remains subject to review, upstream reconciliation and the inherited dependency advisories. Publishing approval does not authorize deployment or merging.

**The RepoLens improvements are implemented and ready for review. Do you approve publishing these changes to GitHub?**
