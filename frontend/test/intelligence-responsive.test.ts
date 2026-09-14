import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Reads are done from the project directory because the jsdom test environment rewrites
// `import.meta.url`, so it is not a usable file URL here.
function readProjectFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

describe("insights responsive and accessibility contract", () => {
  it("defines mobile rules and avoids horizontal overflow", () => {
    const css = readProjectFile("app/globals.css");
    expect(css).toContain("@media (max-width: 390px)");
    expect(css).toContain(".insights-page { padding-bottom: 56px; }");
    expect(css).toContain("overflow-x: hidden");
  });

  it("uses semantic status and navigation attributes in the dashboard source", () => {
    const source = readProjectFile("components/InsightsDashboard.tsx");
    expect(source).toContain('role="status"');
    expect(source).toContain("<Link");
    expect(source).toContain("aria-label");
  });
});
