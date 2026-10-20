"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DependencyGraphResult } from "../lib/api/graph-types";
import type { GraphFilter } from "../lib/graph/dependency-graph";
import {
  aggregateModules,
  defaultState,
  filterGraph,
  indexGraph,
  readWorkspaceState,
  searchIndex,
  subsetGraph,
  traverse,
  workspaceParams,
  type WorkspaceState,
  type EntityKind,
  type Visit,
} from "../lib/graph/workbench";
import { DependencyGraphCanvas } from "./DependencyGraph";
import { GraphCommandPalette } from "./GraphCommandPalette";
import { GraphInspector } from "./GraphInspector";
import { GraphExplorer } from "./GraphExplorer";
import { GraphToolbar } from "./GraphToolbar";

const FILTERS: GraphFilter[] = [
  "ALL",
  "CYCLES",
  "UNRESOLVED",
  "EXTERNAL",
  "IMPORTANT",
];
const PAGE_SIZE = 100;
const EMPTY = new Set<string>();

export function GraphWorkbench({
  graph,
  analysisId,
  demo = false,
}: {
  graph: DependencyGraphResult;
  analysisId?: string;
  demo?: boolean;
}) {
  const index = useMemo(() => indexGraph(graph), [graph]);
  const [state, setState] = useState<WorkspaceState>(() =>
    demo || typeof window === "undefined"
      ? { ...defaultState, level: demo ? "files" : "modules" }
      : readWorkspaceState(new URLSearchParams(window.location.search), graph),
  );
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [palette, setPalette] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [explorer, setExplorer] = useState(!demo);
  const [inspector, setInspector] = useState(!demo);
  const [isolate, setIsolate] = useState(false);
  const [minimap, setMinimap] = useState(!demo);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (window.matchMedia("(max-width: 768px)").matches) {
      setMinimap(false);
      if (demo) setState((previous) => ({ ...previous, level: "modules" }));
    }
  }, [demo]);

  const update = useCallback(
    (change: Partial<WorkspaceState>) => {
      if (change.mode === "normal") setIsolate(false);
      setState((previous) => {
        const next = { ...previous, ...change };
        if (!demo) {
          const params = workspaceParams(next, graph).toString();
          const url = `${window.location.pathname}${params ? `?${params}` : ""}`;
          if (url !== `${window.location.pathname}${window.location.search}`)
            window.history.pushState(null, "", url);
        }
        return next;
      });
      setPage(0);
    },
    [demo, graph],
  );

  useEffect(() => {
    const pop = () => {
      if (!demo) {
        setState(
          readWorkspaceState(
            new URLSearchParams(window.location.search),
            graph,
          ),
        );
        setPage(0);
      }
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, [demo, graph]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const editing =
        event.target instanceof Element &&
        event.target.closest("input,textarea,select,[contenteditable=true]");
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !editing
      ) {
        event.preventDefault();
        setPalette(true);
      }
      if (event.key === "Escape" && !palette && expanded) {
        setExpanded(false);
        fullscreenButton.current?.focus();
      }
      if (event.key === "Tab" && expanded && !palette) {
        const controls = [
          ...(root.current?.querySelectorAll<HTMLElement>(
            "button:not([disabled]),a[href],input,select,[tabindex='0']",
          ) ?? []),
        ].filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === root.current)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [expanded, palette]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    const inert: { element: HTMLElement; previous: boolean }[] = [];
    let current = root.current as HTMLElement | null;
    while (current?.parentElement && current.parentElement !== document.body) {
      for (const sibling of current.parentElement.children)
        if (sibling !== current && sibling instanceof HTMLElement) {
          inert.push({ element: sibling, previous: sibling.inert });
          sibling.inert = true;
        }
      current = current.parentElement;
    }
    document.body.style.overflow = "hidden";
    root.current?.focus();
    return () => {
      document.body.style.overflow = previous;
      for (const item of inert) item.element.inert = item.previous;
    };
  }, [expanded]);

  const choose = useCallback(
    (id: string, kind: EntityKind = "node") => {
      setIsolate(false);
      setQuery("");
      setInspector(true);
      if (kind === "cycle") {
        const cycle = Number(id.slice(6));
        if (!graph.cycles[cycle]) return;
        update({
          cycle,
          file: graph.cycles[cycle].files[0],
          module: null,
          level: "files",
          mode: "normal",
          filter: "ALL",
        });
      } else if (kind === "module" && index.moduleById.has(id))
        update({ module: id, level: "files", cycle: null, mode: "normal" });
      else if (index.nodes.has(id))
        update({
          file: id,
          module:
            index.moduleByNode.get(id) === state.module ? state.module : null,
          level: "files",
          cycle: null,
          mode: "normal",
          filter: "ALL",
        });
    },
    [graph, index, update, state.module],
  );

  const selectCanvas = useCallback(
    (id: string) => choose(id, state.level === "modules" ? "module" : "node"),
    [choose, state.level],
  );

  const visits = useMemo(
    () =>
      state.file
        ? traverse(
            index,
            state.file,
            state.mode === "normal"
              ? "both"
              : state.mode === "impact"
                ? "dependents"
                : state.direction,
            state.mode === "normal" ? 1 : state.depth,
          )
        : new Map<string, Visit>(),
    [index, state.file, state.mode, state.direction, state.depth],
  );
  const focus = useMemo(
    () =>
      state.cycle !== null
        ? new Set(graph.cycles[state.cycle]?.files ?? [])
        : state.file
          ? new Set(visits.keys())
          : null,
    [graph, state.cycle, state.file, visits],
  );
  const filtered = useMemo(() => {
    let result = filterGraph(graph, index, state.filter);
    if (state.module && state.level === "files")
      result = subsetGraph(
        result,
        new Set(index.moduleById.get(state.module)?.members ?? []),
      );
    if (state.cycle !== null) {
      const cycle = graph.cycles[state.cycle];
      result = {
        ...subsetGraph(result, new Set(cycle?.files ?? [])),
        cycles: cycle ? [cycle] : [],
      };
    }
    return result;
  }, [graph, index, state.filter, state.module, state.level, state.cycle]);
  const investigationFocus = isolate || state.mode === "impact" ? focus : null;
  const candidates = useMemo(
    () =>
      investigationFocus ? subsetGraph(filtered, investigationFocus) : filtered,
    [filtered, investigationFocus],
  );
  const projection = useMemo(
    () =>
      state.level === "modules"
        ? aggregateModules(candidates, index)
        : candidates,
    [candidates, index, state.level],
  );
  const paged = useMemo(() => {
    const ids = projection.nodes
      .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
      .map((node) => node.id);
    return subsetGraph(projection, new Set(ids));
  }, [projection, page]);
  const visible = useMemo(() => {
    // Preserve geometry when selection is already on this page.
    if (
      state.level !== "files" ||
      !state.file ||
      paged.nodes.some((node) => node.id === state.file) ||
      !projection.nodes.some((node) => node.id === state.file)
    )
      return paged;
    return subsetGraph(
      projection,
      new Set([...paged.nodes.map((node) => node.id), state.file]),
    );
  }, [paged, projection, state.file, state.level]);
  const cycleIds = useMemo(
    () =>
      state.level === "modules"
        ? EMPTY
        : new Set(
            state.cycle !== null
              ? (graph.cycles[state.cycle]?.files ?? [])
              : graph.cycles.flatMap((cycle) => cycle.files),
          ),
    [graph, state.level, state.cycle],
  );
  const matches = useMemo(() => searchIndex(index, query), [index, query]);
  const candidateIds = useMemo(
    () => new Set(candidates.nodes.map((node) => node.id)),
    [candidates],
  );
  const exploreEntries = useMemo(
    () =>
      matches.filter((entry) =>
        state.level === "modules"
          ? entry.category === "Module" &&
            index.moduleById
              .get(entry.id)
              ?.members.some((id) => candidateIds.has(id))
          : entry.category !== "Module" &&
            entry.category !== "Cycle" &&
            candidateIds.has(entry.id),
      ),
    [matches, state.level, index, candidateIds],
  );
  const [explorerLimit, setExplorerLimit] = useState(100);
  useEffect(
    () => setExplorerLimit(100),
    [query, state.level, state.module, state.filter],
  );

  const reset = () => {
    setQuery("");
    setIsolate(false);
    update({
      ...defaultState,
      level:
        demo && !window.matchMedia("(max-width: 768px)").matches
          ? "files"
          : "modules",
    });
  };
  return (
    <section
      ref={root}
      tabIndex={-1}
      className={`intelligence-workspace${demo ? " demo-workspace" : ""}${expanded ? " intelligence-expanded" : ""}`}
      aria-label={
        demo
          ? "Interactive demonstration repository"
          : "Repository graph workspace"
      }
    >
      <header className="workbench-heading">
        <div>
          <span className="section-kicker">
            {demo
              ? "DEMO DATA — NOT A LIVE REPOSITORY ANALYSIS"
              : "Dependency workbench"}
          </span>
          <h2>
            {demo ? "Parcel / fictional sample · v1" : "Explore the structure."}
          </h2>
        </div>
        <div className="workbench-actions">
          <button type="button" onClick={() => setPalette(true)}>
            Search <kbd>Ctrl / ⌘ K</kbd>
          </button>
          <button
            ref={fullscreenButton}
            type="button"
            aria-label={expanded ? "Exit fullscreen" : "Expand graph"}
            onClick={() => {
              setExpanded((value) => !value);
              if (expanded) fullscreenButton.current?.focus();
            }}
          >
            {expanded ? "Exit fullscreen" : "Expand graph"}
          </button>
        </div>
      </header>
      {demo ? (
        <div className="demo-actions">
          <button
            type="button"
            onClick={() =>
              update({
                level: "modules",
                file: null,
                cycle: null,
                mode: "normal",
                module: null,
              })
            }
          >
            Explore architecture
          </button>
          <button type="button" onClick={() => choose("domain/orders.ts")}>
            Inspect dependencies
          </button>
          <button type="button" onClick={() => choose("cycle:0", "cycle")}>
            Find a cycle
          </button>
          <button
            type="button"
            onClick={() => {
              setInspector(true);
              update({
                file: "data/store.ts",
                module: null,
                level: "files",
                mode: "impact",
                direction: "dependents",
                depth: Infinity,
                cycle: null,
              });
            }}
          >
            Simulate change impact
          </button>
          <button type="button" onClick={reset}>
            Reset demo
          </button>
        </div>
      ) : null}
      <GraphToolbar
        state={state}
        filters={FILTERS}
        onFilter={(filter) => {
          setIsolate(false);
          const result = filterGraph(graph, index, filter);
          update({
            filter,
            cycle: null,
            mode: "normal",
            module: null,
            file: result.nodes.some((node) => node.id === state.file)
              ? state.file
              : null,
          });
        }}
        update={update}
        explorer={explorer}
        inspector={inspector}
        minimap={minimap}
        setExplorer={setExplorer}
        setInspector={setInspector}
        setMinimap={setMinimap}
        reset={reset}
      />
      <nav
        className="workbench-breadcrumb"
        aria-label="Graph exploration breadcrumb"
      >
        <button
          type="button"
          onClick={() =>
            update({
              module: null,
              level: "modules",
              cycle: null,
              mode: "normal",
            })
          }
        >
          Repository
        </button>
        <span>/</span>
        <button type="button" onClick={() => update({ level: "files" })}>
          {state.module
            ? index.modules.find((module) => module.id === state.module)?.label
            : "All files"}
        </button>
        <span>
          · Level{" "}
          {state.level === "modules" ? "1 / directory groups" : "2 / files"}
          {state.mode !== "normal" ? ` · ${state.mode}` : ""}
        </span>
        {state.module ? (
          <button
            type="button"
            onClick={() => update({ module: null, level: "modules" })}
          >
            Collapse module
          </button>
        ) : null}
      </nav>
      <div
        className={`workbench-body${explorer ? " has-explorer" : ""}${inspector ? " has-inspector" : ""}`}
      >
        {explorer ? (
          <GraphExplorer
            query={query}
            setQuery={setQuery}
            exploreEntries={exploreEntries}
            explorerLimit={explorerLimit}
            selectedId={state.file}
            choose={choose}
            onMore={() => setExplorerLimit((value) => value + 100)}
          />
        ) : null}
        <div className="workbench-center">
          <div className="graph-readout" role="status">
            <span>
              {visible.nodes.length} visible / {projection.nodes.length} in view
              · {graph.nodes.length} total entities
            </span>
            <span>Source → dependency</span>
          </div>
          {projection.nodes.length > PAGE_SIZE ? (
            <div className="graph-pagination">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
              >
                Previous 100
              </button>
              <span>
                Page {page + 1} /{" "}
                {Math.ceil(projection.nodes.length / PAGE_SIZE)} · edges between
                visible nodes
              </span>
              <button
                type="button"
                disabled={(page + 1) * PAGE_SIZE >= projection.nodes.length}
                onClick={() => setPage((value) => value + 1)}
              >
                Next 100
              </button>
            </div>
          ) : null}
          {state.file && state.level === "files" ? (
            <div className="focus-controls">
              <button
                type="button"
                aria-pressed={isolate}
                onClick={() => setIsolate((value) => !value)}
              >
                Isolate selection
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsolate(false);
                  update({ file: null, mode: "normal", cycle: null });
                }}
              >
                Clear selection
              </button>
            </div>
          ) : null}
          <DependencyGraphCanvas
            graph={visible}
            cycleIds={cycleIds}
            focusedIds={state.level === "files" ? focus : null}
            selectedId={state.level === "files" ? state.file : state.module}
            onSelect={selectCanvas}
            layoutMode={state.layout}
            minimap={minimap}
            impactVisits={state.mode === "impact" ? visits : undefined}
          />
          {!visible.nodes.length ? (
            <p className="workbench-empty" role="status">
              No entities match this view. Reset graph or change the filter.
            </p>
          ) : null}
          <p className="workbench-footnote">
            {state.level === "modules"
              ? "Directory and dependency groups aggregate actual relationships. Select a group to expand its files."
              : "Use the explorer for keyboard navigation. Selected context stays visible; arrows identify dependency direction."}
            {visible.edges.length > visible.nodes.length * 4
              ? " Dense views use SCC dependency layers, grid placement and straight edges. Isolate selection to reduce visual complexity."
              : ""}
          </p>
        </div>
        {inspector ? (
          <aside
            className="workbench-inspector"
            aria-label="Dependency graph analysis"
          >
            <GraphInspector
              graph={graph}
              index={index}
              state={state}
              visits={visits}
              analysisId={analysisId}
              update={update}
              choose={choose}
            />
          </aside>
        ) : null}
      </div>
      {palette ? (
        <GraphCommandPalette
          index={index}
          onChoose={choose}
          onClose={() => setPalette(false)}
        />
      ) : null}
    </section>
  );
}
