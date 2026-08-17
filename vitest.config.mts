import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Directories with a 100% coverage gate (mirrored in `coverage.thresholds` below).
 * `coverage.include` makes an orphan file — one nothing imports, like a barrel — show up
 * as 0% and fail its threshold instead of being invisible to the run. Because `include`
 * forces every matching file into the measurement, verify the gate with an UNFILTERED
 * `npm run test:coverage` (a path-filtered run would report the other directory at 0%).
 */
const COVERAGE_GATED_DIRS = ["src/scoring", "src/draft-engine"] as const;
const coverageInclude = COVERAGE_GATED_DIRS.map((dir) => `${dir}/**`);

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "happy-dom",
    // Integration tests share one real Postgres/Redis and truncate between tests, so
    // test FILES must not interleave. Tests within a file already run sequentially.
    fileParallelism: false,
    setupFiles: ["./vitest.setup.mts"],
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: coverageInclude,
      thresholds: {
        "src/scoring/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/draft-engine/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
});
