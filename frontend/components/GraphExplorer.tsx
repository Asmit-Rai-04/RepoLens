"use client";
import type { EntityKind, GraphIndex } from "../lib/graph/workbench";
export function GraphExplorer({
  query,
  setQuery,
  exploreEntries,
  explorerLimit,
  selectedId,
  choose,
  onMore,
}: {
  query: string;
  setQuery: (query: string) => void;
  exploreEntries: GraphIndex["search"];
  explorerLimit: number;
  selectedId: string | null;
  choose: (id: string, kind?: EntityKind) => void;
  onMore: () => void;
}) {
  return (
    <aside className="workbench-explorer" aria-label="Graph explorer">
      <label>
        Search files / modules
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Path or directory name"
        />
      </label>
      <p>
        {exploreEntries.length} matches · complete dataset searchable via
        command palette
      </p>
      <ul>
        {exploreEntries.slice(0, explorerLimit).map((entry) => (
          <li key={`${entry.category}:${entry.id}`}>
            <button
              type="button"
              aria-current={selectedId === entry.id ? "true" : undefined}
              onClick={() =>
                choose(
                  entry.id,
                  entry.category === "Module" ? "module" : "node",
                )
              }
            >
              <span>
                {entry.category === "Module" ? "▸ " : ""}
                {entry.label}
              </span>
              <small>{entry.category}</small>
            </button>
          </li>
        ))}
      </ul>
      {exploreEntries.length > explorerLimit ? (
        <button type="button" onClick={() => onMore()}>
          Show 100 more results
        </button>
      ) : null}
      {!exploreEntries.length ? (
        <p role="status">
          No matches in this view. Search all data with Ctrl / ⌘ K.
        </p>
      ) : null}
    </aside>
  );
}
