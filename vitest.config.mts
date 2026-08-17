import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Directories with a 100% coverage gate (mirrored in `coverage.thresholds` below).
 * `coverage.include` is what makes an orphan file — one nothing imports, like a barrel
 * module — show up as 0% instead of being invisible to the coverage run: without it, only
 * files a test happens to load are measured at all, so an unimported file silently stops
 * counting against its directory's threshold.
 *
 * But `coverage.include` also unconditionally counts every matching file into the run,
 * even when a CLI test-path filter (`vitest run --coverage src/scoring`) means the OTHER
 * directory's files were never going to execute — which would make that directory show
 * 0% and fail its threshold despite not being part of the requested run at all. Scope the
 * include list to whichever of these directories the CLI test-path filter actually targets,
 * so `npm run test:coverage -- src/draft-engine` and `-- src/scoring` each stay
 * independently meaningful. No filter (or one that matches neither directory) falls back to
 * measuring both, which is what a full `npm run test:coverage` needs.
 */
const COVERAGE_GATED_DIRS = ["src/scoring", "src/draft-engine"] as const;

const testPathArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("-") && arg !== "run");
const targetedDirs = COVERAGE_GATED_DIRS.filter((dir) => testPathArgs.some((arg) => arg.startsWith(dir)));
const coverageInclude = (targetedDirs.length > 0 ? targetedDirs : COVERAGE_GATED_DIRS).map((dir) => `${dir}/**`);

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
