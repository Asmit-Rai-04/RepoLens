import { describe, expect, it, vi } from "vitest";
import { getArchitecture } from "../lib/api/client";

const response = {
  report: {
    primary: {
      architecture: "Layered",
      confidence: 0.87,
      evidence: [],
      layers: [
        { name: "controller", paths: ["src/controller/A.ts"], expected_dependencies: ["service"], forbidden_dependencies: ["repository"], observed_dependencies: ["service"] },
        { name: "service", paths: ["src/service/A.ts"], expected_dependencies: ["repository"], forbidden_dependencies: [], observed_dependencies: ["repository"] },
      ],
      violations: [],
      framework_evidence: [],
    },
    alternatives: [],
    monorepo: { is_monorepo: false, roots: [], evidence: [] },
    summary: "A layered repository.",
    layer_map: {},
    metadata: {},
  },
  layer_edges: [{ source_layer: "controller", target_layer: "service", import_count: 2, supporting_files: ["src/controller/A.ts", "src/service/A.ts"], violation: false }],
};

describe("architecture API", () => {
  it("fetches the real Milestone 5 architecture endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    await expect(getArchitecture("abc")).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/api/analyze/abc/architecture", expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }));
  });
});
