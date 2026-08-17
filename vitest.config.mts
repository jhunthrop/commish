import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Directories with a 100% coverage gate (mirrored in `coverage.thresholds` below).
 * `coverage.include` protects LOGIC files that nothing imports: without it, a real file no
 * test ever pulls in wouldn't be instrumented at all, and a 100% threshold checked only
 * against instrumented files can't fail on work that's silently missing coverage. It does
 * NOT protect a pure re-export barrel — a barrel has no statements/branches of its own, so
 * it measures 0/0 and a 0/0 percentage passes any threshold trivially. The real protection
 * for a barrel is a smoke test that imports it and asserts its exports exist. Because
 * `include` forces every matching file into the measurement, verify the gate with an
 * UNFILTERED `npm run test:coverage` (a path-filtered run would report the other directory
 * at 0%).
 */
const COVERAGE_GATED_DIRS = ["src/scoring", "src/draft-engine", "src/draft-room/state"] as const;
const coverageInclude = COVERAGE_GATED_DIRS.map((dir) => `${dir}/**`);

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "happy-dom",
    // Harness worktrees are nested checkouts — never collect their tests from the parent.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/.next/**"],
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
        "src/draft-room/state/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
});
