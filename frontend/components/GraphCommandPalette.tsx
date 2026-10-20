"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  searchIndex,
  type EntityKind,
  type GraphIndex,
} from "../lib/graph/workbench";

export function GraphCommandPalette({
  index,
  onChoose,
  onClose,
}: {
  index: GraphIndex;
  onChoose: (id: string, kind: EntityKind) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () => searchIndex(index, query).slice(0, 40),
    [index, query],
  );
  useEffect(() => {
    document
      .getElementById(`command-result-${active}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const element = dialog.current;
    element?.showModal?.();
    input.current?.focus();
    return () => {
      element?.close?.();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="command-dialog"
      aria-label="Search repository"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <header>
        <strong>Find a file, directory group, or cycle</strong>
        <button type="button" onClick={onClose} aria-label="Close search">
          Esc
        </button>
      </header>
      <input
        ref={input}
        role="combobox"
        aria-label="Search repository"
        aria-expanded="true"
        aria-controls="graph-search-results"
        aria-activedescendant={
          results[active] ? `command-result-${active}` : undefined
        }
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((value) =>
              Math.max(0, Math.min(value + 1, results.length - 1)),
            );
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((value) => Math.max(0, value - 1));
          }
          if (event.key === "Enter" && results[active]) {
            event.preventDefault();
            onChoose(
              results[active].id,
              results[active].category === "Cycle"
                ? "cycle"
                : results[active].category === "Module"
                  ? "module"
                  : "node",
            );
            onClose();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      />
      <ul
        id="graph-search-results"
        role="listbox"
        aria-label="Repository search results"
      >
        {results.map((result, i) => (
          <li
            key={`${result.category}:${result.id}`}
            id={`command-result-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
          >
            <button
              type="button"
              tabIndex={-1}
              onClick={() => {
                onChoose(
                  result.id,
                  result.category === "Cycle"
                    ? "cycle"
                    : result.category === "Module"
                      ? "module"
                      : "node",
                );
                onClose();
              }}
            >
              <span>{result.category}</span>
              <code>{result.label}</code>
            </button>
          </li>
        ))}
      </ul>
      {!results.length ? (
        <p role="status">No matching entities.</p>
      ) : (
        <p>↑ ↓ to navigate · Enter to investigate · Showing up to 40 results</p>
      )}
    </dialog>
  );
}
