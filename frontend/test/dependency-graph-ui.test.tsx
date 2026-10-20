import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("dependency graph UI requirements", () => {
  const source = ["app/analyze/[id]/graph/page.tsx", "components/GraphWorkbench.tsx", "components/GraphToolbar.tsx", "components/GraphInspector.tsx"].map(path => readFileSync(join(process.cwd(), path), "utf8")).join("\n");
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  it("contains all required filters, focus surfaces, and file inspector navigation", () => {
    for (const label of ["ALL", "CYCLES", "UNRESOLVED", "EXTERNAL", "IMPORTANT"]) expect(source).toContain(label);
    expect(source).toContain("Open File Inspector");
    expect(source).toContain("Clear focus");
    expect(source).toContain("role=\"tablist\"");
    expect(source).toContain("aria-selected");
    expect(source).toContain("Detected cycles");
    expect(source).toContain("Strong components");
    expect(source).toContain("Backend ranking");
  });

  it("contains mobile and overflow-safe layout rules", () => {
    expect(css).toContain("@media (max-width: 540px)");
    expect(css).toContain("word-break" );
    expect(css).toContain("overflow-wrap: anywhere");
  });
});
