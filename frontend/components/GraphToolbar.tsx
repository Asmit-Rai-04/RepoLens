"use client";
import type { Dispatch, SetStateAction } from "react";
import type { GraphFilter } from "../lib/graph/dependency-graph";
import type { WorkspaceState } from "../lib/graph/workbench";
export function GraphToolbar({
  state,
  filters: FILTERS,
  onFilter,
  update,
  explorer,
  inspector,
  minimap,
  setExplorer,
  setInspector,
  setMinimap,
  reset,
}: {
  state: WorkspaceState;
  filters: GraphFilter[];
  onFilter: (filter: GraphFilter) => void;
  update: (change: Partial<WorkspaceState>) => void;
  explorer: boolean;
  inspector: boolean;
  minimap: boolean;
  setExplorer: Dispatch<SetStateAction<boolean>>;
  setInspector: Dispatch<SetStateAction<boolean>>;
  setMinimap: Dispatch<SetStateAction<boolean>>;
  reset: () => void;
}) {
  return (
    <div className="workbench-toolbar">
      <div
        className="filter-tabs"
        role="tablist"
        aria-label="Dependency graph filters"
      >
        {FILTERS.map((filter) => (
          <button
            type="button"
            role="tab"
            aria-selected={state.filter === filter}
            key={filter}
            onClick={() => {
              onFilter(filter);
            }}
          >
            {filter}
          </button>
        ))}
      </div>
      <label>
        Layout
        <select
          aria-label="Layout"
          value={state.layout}
          onChange={(event) =>
            update({ layout: event.target.value as WorkspaceState["layout"] })
          }
        >
          <option value="hierarchical">Hierarchical</option>
          <option value="compact">Compact flow</option>
        </select>
      </label>
      <button
        type="button"
        aria-pressed={explorer}
        onClick={() => setExplorer((value) => !value)}
      >
        Explorer
      </button>
      <button
        type="button"
        aria-pressed={inspector}
        onClick={() => setInspector((value) => !value)}
      >
        Inspector
      </button>
      <button
        type="button"
        aria-pressed={minimap}
        onClick={() => setMinimap((value) => !value)}
      >
        Minimap
      </button>
      <button type="button" onClick={reset}>
        Reset graph
      </button>
    </div>
  );
}
