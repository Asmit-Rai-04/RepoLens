import React, { Suspense } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import FilePage from "../app/analyze/[id]/files/[...path]/page";

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("symbol=helper") }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }));
vi.mock("../components/BrandHeader", () => ({ BrandHeader: () => <header>RepoLens</header> }));
vi.mock("../lib/api/client", () => ({
  getFile: vi.fn().mockResolvedValue({
    source_file: {
      path: "src/utils.py", kind: "source", language: "python", parse_status: "success", parse_error: null, size_bytes: 30, package_name: null,
      symbols: [{ name: "helper", kind: "function", line_start: 1, line_end: 2, column_start: 0, column_end: 15, parent: null }], imports: [], inheritance: [],
    }, layer: "service", resolved_imports: [], unresolved_imports: [], external_imports: [],
  }),
  getSource: vi.fn().mockResolvedValue({ path: "src/utils.py", content: "def helper():\n    return 1", language: "python" }),
}));

describe("file viewer", () => {
  it("renders symbol metadata, line numbers, and selected-symbol highlighting", async () => {
    // The page unwraps its route params with React 19 `use`, so it needs the Suspense boundary
    // that the Next.js App Router provides in the real application. `act` is awaited so the
    // params promise settles inside the act scope.
    await act(async () => {
      render(
        <Suspense fallback={<p>Loading file analysis…</p>}>
          <FilePage params={Promise.resolve({ id: "abc", path: ["src", "utils.py"] })} />
        </Suspense>,
      );
    });
    expect(await screen.findByText("helper")).toBeInTheDocument();
    expect(screen.getByText("1–2")).toBeInTheDocument();
    // With a symbol selected the source header names it and its line range.
    expect(screen.getByText("helper · lines 1–2")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Source code for src/utils.py" })).toBeInTheDocument();
    expect(screen.getByText("def helper():")).toBeInTheDocument();
    expect(screen.getByText("service")).toBeInTheDocument();
  });
});
