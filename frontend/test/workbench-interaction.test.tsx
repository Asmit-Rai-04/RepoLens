import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import { GraphWorkbench } from "../components/GraphWorkbench";
import { demoGraph } from "../lib/graph/demo";

vi.mock("next/link", () => ({
  default: ({
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));
vi.mock("../components/DependencyGraph", () => ({
  DependencyGraphCanvas: ({
    graph,
    onSelect,
  }: {
    graph: typeof demoGraph;
    onSelect: (id: string) => void;
  }) => (
    <div aria-label="Test graph canvas">
      <output data-testid="canvas-cycle-count">{graph.cycles.length}</output>
      {graph.nodes.map((node) => (
        <button key={node.id} onClick={() => onSelect(node.id)}>
          {node.path_name}
        </button>
      ))}
    </div>
  ),
}));

describe("workbench interactions", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    HTMLDialogElement.prototype.showModal = function () {
      this.open = true;
    };
    HTMLDialogElement.prototype.close = function () {
      this.open = false;
    };
  });
  it("distinguishes real file IDs from module/cycle command identifiers", () => {
    const graph = {
      ...demoGraph,
      nodes: [
        ...demoGraph.nodes,
        { ...demoGraph.nodes[0], id: "cycle:0", path_name: "cycle:0" },
        { ...demoGraph.nodes[0], id: "module:root", path_name: "module:root" },
      ],
    };
    render(<GraphWorkbench graph={graph} analysisId="abc" />);
    fireEvent.click(screen.getByRole("button", { name: "All files" }));
    fireEvent.click(
      within(screen.getByLabelText("Test graph canvas")).getByRole("button", {
        name: "cycle:0",
      }),
    );
    expect(
      screen.getByRole("link", { name: "Open File Inspector" }),
    ).toHaveAttribute("href", "/analyze/abc/files/cycle%3A0");
    fireEvent.click(
      within(screen.getByLabelText("Test graph canvas")).getByRole("button", {
        name: "module:root",
      }),
    );
    expect(
      screen.getByRole("heading", { name: "module:root" }),
    ).toBeInTheDocument();
  });
  it("sends only the selected reported cycle to the canvas", () => {
    const files = ["domain/orders.ts", "domain/events.ts", "data/store.ts"];
    const graph = {
      ...demoGraph,
      cycles: [
        { files, length: 3 },
        { files: [...files].reverse(), length: 3 },
      ],
      cycles_truncated: true,
    };
    render(<GraphWorkbench graph={graph} analysisId="abc" />);
    expect(screen.getByTestId("canvas-cycle-count")).toHaveTextContent("0");
    fireEvent.click(screen.getByRole("button", { name: "Cycle 1 · 3 files" }));
    expect(screen.getByTestId("canvas-cycle-count")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Next cycle" }));
    expect(screen.getByTestId("canvas-cycle-count")).toHaveTextContent("1");
  });
  it("expands/collapses directories and restores overview", () => {
    render(<GraphWorkbench graph={demoGraph} analysisId="abc" />);
    const canvas = screen.getByLabelText("Test graph canvas");
    expect(within(canvas).getAllByRole("button")).toHaveLength(4);
    fireEvent.click(within(canvas).getByRole("button", { name: "data" }));
    expect(
      within(canvas).getByRole("button", { name: "data/store.ts" }),
    ).toBeInTheDocument();
    expect(window.location.search).toContain("module=module%3Adir%3Adata");
    fireEvent.click(screen.getByRole("button", { name: "Collapse module" }));
    expect(within(canvas).getAllByRole("button")).toHaveLength(4);
  });
  it("selects files, explores focus/impact and opens genuine source routes", () => {
    render(<GraphWorkbench graph={demoGraph} analysisId="abc" />);
    fireEvent.click(screen.getByRole("button", { name: "All files" }));
    fireEvent.click(
      within(screen.getByLabelText("Test graph canvas")).getByRole("button", {
        name: "data/store.ts",
      }),
    );
    expect(
      screen.getByRole("link", { name: "Open File Inspector" }),
    ).toHaveAttribute("href", "/analyze/abc/files/data/store.ts");
    fireEvent.change(screen.getByLabelText("Direction"), {
      target: { value: "dependents" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Focus selection" }));
    expect(window.location.search).toContain("focus=focus");
    fireEvent.click(screen.getByRole("button", { name: "Isolate selection" }));
    expect(
      within(screen.getByLabelText("Test graph canvas")).getAllByRole("button"),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Clear focus" }));
    expect(
      within(screen.getByLabelText("Test graph canvas")).getAllByRole("button"),
    ).toHaveLength(10);
    fireEvent.click(
      screen.getByRole("button", { name: "Explore change impact" }),
    );
    expect(screen.getByText(/Potentially affected/)).toHaveTextContent(
      "Potentially affected (5)",
    );
    expect(screen.getAllByText(/Transitive dependent/).length).toBeGreaterThan(
      0,
    );
    fireEvent.change(screen.getByLabelText("Dependency depth"), {
      target: { value: "1" },
    });
    expect(screen.getByText(/Potentially affected/)).toHaveTextContent("(1)");
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText("Select a file")).toBeInTheDocument();
  });
  it("runs and resets all demo modes without fetch", () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    render(<GraphWorkbench graph={demoGraph} demo />);
    fireEvent.click(screen.getByRole("button", { name: "Find a cycle" }));
    expect(
      within(screen.getByLabelText("Test graph canvas")).getAllByRole("button"),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Next cycle" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous cycle" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate change impact" }),
    );
    expect(screen.getByText(/Potentially affected/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset demo" }));
    expect(
      within(screen.getByLabelText("Test graph canvas")).getAllByRole("button"),
    ).toHaveLength(10);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it("supports palette keyboard selection, filters, layout and fullscreen Escape", () => {
    render(<GraphWorkbench graph={demoGraph} demo />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const search = screen.getByRole("combobox", { name: "Search repository" });
    fireEvent.change(search, { target: { value: "store" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(
      screen.getByRole("heading", { name: "data/store.ts" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Layout"), {
      target: { value: "compact" },
    });
    expect(screen.getByLabelText("Layout")).toHaveValue("compact");
    fireEvent.click(screen.getByRole("tab", { name: "UNRESOLVED" }));
    expect(screen.getByText(/No entities match/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset graph" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand graph" }));
    expect(
      screen.getByRole("button", { name: "Exit fullscreen" }),
    ).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Expand graph" })).toHaveFocus();
  });
  it("restores URL state on browser back/forward", () => {
    render(<GraphWorkbench graph={demoGraph} analysisId="abc" />);
    window.history.replaceState(
      null,
      "",
      "/?file=data/store.ts&focus=impact&depth=2",
    );
    fireEvent(window, new PopStateEvent("popstate"));
    expect(
      screen.getByRole("heading", { name: "data/store.ts" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Potentially affected/)).toHaveTextContent("(4)");
  });
});
