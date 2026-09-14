import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    globals: true,
    // The analysis-polling test drives the real 1.5s polling interval instead of fake timers,
    // so it needs more than vitest's 5s default.
    testTimeout: 20000,
  },
});
