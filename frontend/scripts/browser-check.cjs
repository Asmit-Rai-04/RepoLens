/* Run against a local production build. Requires Playwright via NODE_PATH.
   API responses are deterministic test fixtures; no live GitHub analysis is simulated in the product. */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ts = require("typescript");
const output = path.resolve(__dirname, "../../.verification");
fs.mkdirSync(output, { recursive: true });
const fixture = { exports: {} };
new Function(
  "exports",
  "module",
  ts.transpileModule(
    fs.readFileSync(path.resolve(__dirname, "../lib/graph/demo.ts"), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
)(fixture.exports, fixture);
const graph = fixture.exports.demoGraph;
const source = fs.readFileSync(
  path.resolve(__dirname, "../test/intelligence.test.tsx"),
  "utf8",
);
const insightsFixture = { exports: {} };
new Function(
  "exports",
  "module",
  ts.transpileModule(
    source.slice(source.indexOf("const report:"), source.indexOf("describe(")) +
      "\nexport { report };",
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText,
)(insightsFixture.exports, insightsFixture);
const insights = insightsFixture.exports.report;
insights.key_findings = [
  {
    severity: "medium",
    category: "dependency_cycle",
    title: "Dependency cycle detected",
    description: "Fixture cycle",
    related_files: graph.cycles[0].files,
  },
];
insights.coupling_hotspots = [
  { ...insights.coupling_hotspots[0], path: "domain/orders.ts" },
];
insights.cycle_severity = [
  { ...insights.cycle_severity[0], files: graph.cycles[0].files, length: 2 },
];
const overview = {
  repository: {
    owner: "fixture",
    name: "parcel",
    canonical_url: "https://github.com/fixture/parcel",
    default_branch: "main",
  },
  files: { total: 10, source_total: 10, by_language: { typescript: 10 } },
  architecture: {
    name: "Layered",
    confidence: 0.8,
    summary: "Test fixture: UI imports domain, domain imports data.",
  },
  graph: { nodes: 10, edges: 14, cycles: 1, strongly_connected_components: 1 },
  violations: 0,
  completeness: { status: "complete", skipped: { reasons: {} } },
};
const architecture = {
  report: {
    primary: {
      architecture: "Layered",
      confidence: 0.8,
      evidence: [],
      layers: [
        {
          name: "ui",
          paths: ["ui/app.ts"],
          expected_dependencies: ["domain"],
          forbidden_dependencies: [],
          observed_dependencies: ["domain"],
        },
        {
          name: "domain",
          paths: ["domain/orders.ts"],
          expected_dependencies: ["data"],
          forbidden_dependencies: [],
          observed_dependencies: ["data"],
        },
      ],
      violations: [],
      framework_evidence: [],
    },
    alternatives: [],
    monorepo: { is_monorepo: false, roots: [], evidence: [] },
    summary: "Test fixture layers.",
    layer_map: {},
    metadata: {},
  },
  layer_edges: [
    {
      source_layer: "ui",
      target_layer: "domain",
      import_count: 2,
      supporting_files: ["ui/app.ts", "domain/orders.ts"],
      violation: false,
    },
  ],
};
let graphResponse = graph;
const checks = [],
  errors = [],
  measurements = [];
async function check(name, run) {
  await run();
  checks.push(name);
  console.log("PASS " + name);
}
async function main() {
  const browser = await chromium.launch({
    channel: process.env.BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  let submitted = null;
  await page.route("http://localhost:8000/api/**", async (route) => {
    const url = new URL(route.request().url());
    const suffix = url.pathname.replace("/api/analyze", "");
    let body,
      status = 200;
    if (!suffix) {
      submitted = route.request().postDataJSON();
      body = { analysis_id: "fixture", status: "queued" };
      status = 202;
    } else if (suffix.endsWith("/graph")) body = graphResponse;
    else if (suffix.endsWith("/overview")) body = overview;
    else if (suffix.endsWith("/architecture")) body = architecture;
    else if (suffix.endsWith("/insights")) body = insights;
    else if (suffix.endsWith("/health")) body = insights.health;
    else if (suffix.endsWith("/files"))
      body = graph.nodes.map((node) => ({
        path: node.path_name,
        language: "typescript",
        parse_status: "success",
        layer: node.path_name.split("/")[0],
        size_bytes: 64,
        symbol_count: 1,
        import_count: graph.edges.filter((edge) => edge.source === node.id)
          .length,
      }));
    else if (suffix.includes("/source/"))
      body = {
        path: decodeURIComponent(suffix.split("/source/")[1]),
        content: "export function sample() {\n  return 1;\n}",
        language: "typescript",
      };
    else if (suffix.includes("/files/"))
      body = {
        source_file: {
          path: decodeURIComponent(suffix.split("/files/")[1]),
          kind: "source",
          language: "typescript",
          parse_status: "success",
          parse_error: null,
          size_bytes: 40,
          package_name: null,
          symbols: [
            {
              name: "sample",
              kind: "function",
              line_start: 1,
              line_end: 3,
              column_start: 0,
              column_end: 1,
              parent: null,
            },
          ],
          imports: [],
          inheritance: [],
        },
        layer: "data",
        resolved_imports: [],
        external_imports: [],
        unresolved_imports: [],
      };
    else
      body = {
        analysis_id: "fixture",
        status: "completed",
        stage: "completed",
      };
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify(body),
    });
  });
  const base = process.env.TEST_BASE_URL || "http://localhost:3000";
  try {
    await check(
      "local demo: real node selection, dependencies, cycle, impact, reset",
      async () => {
        await page.goto(base);
        await page
          .getByRole("button", { name: "Inspect dependencies", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "domain/orders.ts", exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "Find a cycle", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Next cycle", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Previous cycle", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Simulate change impact", exact: true })
          .click();
        await page
          .getByRole("heading", {
            name: "Potentially affected (5)",
            exact: true,
          })
          .waitFor();
        await page
          .getByRole("button", { name: "Reset demo", exact: true })
          .click();
        await page.waitForFunction(() =>
          document
            .querySelector(".graph-readout")
            ?.textContent.includes("10 visible / 10"),
        );
      },
    );
    for (const width of [375, 768, 1024, 1440, 1920])
      await check(`responsive landing + graph at ${width}px`, async () => {
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(base);
        await page
          .getByRole("button", { name: "Reset demo", exact: true })
          .waitFor();
        await page.waitForTimeout(350); // allow responsive orientation and the short fit transition to settle
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: path.join(output, `landing-${width}.png`),
          fullPage: true,
        });
        await page.goto(base + "/analyze/fixture/graph");
        await page
          .getByRole("heading", { name: "Explore the structure.", exact: true })
          .waitFor();
        await page.waitForTimeout(350);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        await page.screenshot({
          path: path.join(output, `graph-${width}.png`),
          fullPage: true,
        });
      });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await check(
      "directory expansion, collapse, palette keyboard and layout",
      async () => {
        await page.goto(base + "/analyze/fixture/graph");
        await page
          .getByLabel("Graph explorer")
          .getByRole("button", { name: "▸ data Module" })
          .click();
        await page
          .getByRole("button", { name: "Collapse module", exact: true })
          .click();
        await page.getByRole("button", { name: /Search Ctrl/ }).click();
        const input = page.getByRole("combobox", { name: "Search repository" });
        await input.fill("store");
        await input.press("ArrowDown");
        await input.press("Enter");
        await page
          .getByRole("heading", { name: "data/store.ts", exact: true })
          .waitFor();
        await page
          .getByLabel("Layout", { exact: true })
          .selectOption("compact");
        await page
          .getByRole("button", { name: "Fit selection", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Expand graph", exact: true })
          .click();
        await page.keyboard.press("Escape");
        assert.equal(
          await page
            .getByRole("button", { name: "Expand graph", exact: true })
            .isVisible(),
          true,
        );
      },
    );
    await check(
      "focus directions, impact depth, filters, selection clear",
      async () => {
        await page
          .getByLabel("Direction", { exact: true })
          .selectOption("dependencies");
        await page
          .getByLabel("Dependency depth", { exact: true })
          .selectOption("2");
        await page
          .getByRole("button", { name: "Isolate selection", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Clear focus", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Explore change impact", exact: true })
          .click();
        await page
          .getByRole("heading", {
            name: "Potentially affected (5)",
            exact: true,
          })
          .waitFor();
        await page
          .getByLabel("Dependency depth", { exact: true })
          .selectOption("1");
        await page
          .getByRole("heading", {
            name: "Potentially affected (1)",
            exact: true,
          })
          .waitFor();
        for (const filter of [
          "EXTERNAL",
          "UNRESOLVED",
          "IMPORTANT",
          "CYCLES",
          "ALL",
        ])
          await page.getByRole("tab", { name: filter, exact: true }).click();
        await page
          .getByLabel("Graph explorer")
          .getByRole("button", { name: "data/store.ts File", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Clear selection", exact: true })
          .click();
      },
    );
    await check("cycle/file deep links and browser back/forward", async () => {
      await page.goto(
        base +
          "/analyze/fixture/graph?cycle=" +
          encodeURIComponent(graph.cycles[0].files.join(",")),
      );
      await page
        .getByRole("button", { name: "Next cycle", exact: true })
        .waitFor();
      await page.waitForFunction(() =>
        document
          .querySelector(".graph-readout")
          ?.textContent.includes("2 visible / 2"),
      );
      await page
        .getByRole("button", { name: "Reset graph", exact: true })
        .click();
      await page.goBack();
      await page
        .getByRole("button", { name: "Next cycle", exact: true })
        .waitFor();
      await page.goForward();
      await page
        .getByRole("button", { name: "All files", exact: true })
        .waitFor();
      await page.goto(
        base + "/analyze/fixture/graph?file=data/store.ts&focus=impact&depth=2",
      );
      await page
        .getByRole("heading", { name: "Potentially affected (4)", exact: true })
        .waitFor();
    });
    await check(
      "graph → source symbols → graph; files search and source links",
      async () => {
        await page
          .getByRole("link", { name: "Open File Inspector", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Source symbols", exact: true })
          .waitFor();
        await page
          .getByRole("link", { name: "Explore dependencies", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "data/store.ts", exact: true })
          .waitFor();
        await page.getByRole("link", { name: "FILES", exact: true }).click();
        await page
          .getByLabel("Search repository files", { exact: true })
          .fill("store");
        await page
          .getByRole("link", { name: /data\/store.ts.*success/ })
          .click();
        await page
          .getByRole("heading", { name: "Source symbols", exact: true })
          .waitFor();
      },
    );
    await check(
      "insights → cycle investigation; architecture → graph",
      async () => {
        await page.goto(base + "/analyze/fixture/insights");
        await page
          .getByRole("link", { name: /Dependency cycle detected/ })
          .click();
        await page
          .getByRole("button", { name: "Next cycle", exact: true })
          .waitFor();
        await page.goto(base + "/analyze/fixture/architecture");
        await page.getByRole("link", { name: "GRAPH", exact: true }).click();
        await page
          .getByRole("heading", { name: "Explore the structure.", exact: true })
          .waitFor();
      },
    );
    await check(
      "invalid URL rejection; live submission contract → progress → overview → graph",
      async () => {
        await page.goto(base);
        const input = page.getByLabel("GitHub repository URL", { exact: true });
        await input.fill("https://github.com.evil.test/owner/repo");
        await input.press("Enter");
        await page.locator("#repository-url-error").waitFor();
        assert.equal(submitted, null);
        await input.fill("https://github.com/pallets/flask");
        await input.press("Enter");
        await page.waitForURL("**/overview");
        assert.deepEqual(submitted, {
          repository_url: "https://github.com/pallets/flask",
        });
        await page
          .getByRole("link", { name: "DEPENDENCY GRAPH", exact: true })
          .click();
        await page
          .getByRole("heading", { name: "Explore the structure.", exact: true })
          .waitFor();
      },
    );
    await check(
      "pan, zoom, reduced motion and fullscreen keyboard containment",
      async () => {
        await page.goto(base + "/analyze/fixture/graph");
        await page.locator(".react-flow__node").first().waitFor();
        await page.waitForTimeout(350);
        const before = await page
          .locator(".react-flow__viewport")
          .evaluate((element) => element.style.transform);
        await page.locator(".react-flow__controls-zoomin").click();
        await page.waitForFunction(
          (previous) =>
            document.querySelector(".react-flow__viewport")?.style.transform !==
            previous,
          before,
        );
        const pane = await page.locator(".react-flow__pane").boundingBox();
        const beforePan = await page
          .locator(".react-flow__viewport")
          .evaluate((element) => element.style.transform);
        await page.mouse.move(pane.x + 15, pane.y + 50);
        await page.mouse.down();
        await page.mouse.move(pane.x + 70, pane.y + 90, { steps: 5 });
        await page.mouse.up();
        await page.waitForFunction(
          (previous) =>
            document.querySelector(".react-flow__viewport")?.style.transform !==
            previous,
          beforePan,
        );
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(
          await page
            .locator(".dependency-node")
            .first()
            .evaluate(
              (element) =>
                parseFloat(getComputedStyle(element).transitionDuration) <
                0.001,
            ),
          true,
        );
        assert.equal(
          await page.locator(".react-flow__edge.animated").count(),
          0,
        );
        await page
          .getByRole("button", { name: "Expand graph", exact: true })
          .click();
        await page.keyboard.press("Tab");
        assert.equal(
          await page.evaluate(() =>
            Boolean(document.activeElement.closest(".intelligence-expanded")),
          ),
          true,
        );
        await page.keyboard.press("Escape");
        await page.emulateMedia({ reducedMotion: "no-preference" });
      },
    );
    for (const width of [375, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const section of [
        "overview",
        "architecture",
        "files",
        "insights",
        "files/data/store.ts",
      ]) {
        await page.goto(base + "/analyze/fixture/" + section);
        await page.waitForLoadState("networkidle");
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
          `Overflow in ${section} at ${width}px`,
        );
      }
      checks.push(`shared pages fit ${width}px`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    for (const { size, density } of [20, 100, 500, 1500].flatMap((size) =>
      [3, 16].map((density) => ({ size, density })),
    )) {
      const nodes = Array.from({ length: size }, (_, i) => ({
        ...graph.nodes[0],
        id: `src/module${i % 10}/file${i}.ts`,
        path_name: `src/module${i % 10}/file${i}.ts`,
      }));
      graphResponse = {
        ...graph,
        nodes,
        edges: nodes.flatMap((node, i) =>
          Array.from({ length: Math.min(density, size - 1) }, (_, j) => ({
            ...graph.edges[0],
            source: node.id,
            target: nodes[(i + j + 1) % size].id,
            source_file: node.id,
            target_file: nodes[(i + j + 1) % size].id,
            import_evidence: {
              module: nodes[(i + j + 1) % size].id,
              origin: "synthetic performance fixture",
            },
          })),
        ),
        cycles: [],
        strongly_connected_components: [],
      };
      const start = performance.now();
      await page.goto(base + "/analyze/large/graph");
      await page.locator(".react-flow__node").first().waitFor();
      const readyMs = performance.now() - start;
      const selectionStart = performance.now();
      await page.getByRole("button", { name: /Search Ctrl/ }).click();
      await page
        .getByRole("combobox", { name: "Search repository" })
        .fill(`file${size - 1}.ts`);
      await page
        .getByRole("combobox", { name: "Search repository" })
        .press("Enter");
      await page
        .getByRole("heading", { name: nodes[size - 1].path_name, exact: true })
        .waitFor();
      await page.locator(".react-flow__node.selected").waitFor();
      measurements.push({
        nodes: size,
        density,
        edges: graphResponse.edges.length,
        readyMs: Number(readyMs.toFixed(1)),
        searchAndSelectionMs: Number(
          (performance.now() - selectionStart).toFixed(1),
        ),
        renderedNodes: await page.locator(".react-flow__node").count(),
        heapSnapshotBytes: await page.evaluate(
          () => performance.memory?.usedJSHeapSize ?? null,
        ),
      });
      assert.equal(
        (await page.getByLabel("Graph explorer").locator("li").count()) <= 100,
        true,
      );
    }
    graphResponse = graph;
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, "browser-results.json"),
      JSON.stringify(
        {
          checks,
          errors,
          measurements,
          notes:
            "Local production build; intercepted fixture API; browser timings include navigation and Playwright waits, are single samples, and are not a before/after benchmark.",
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({ checks: checks.length, errors, measurements }),
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
