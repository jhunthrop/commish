import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Directories with a 100% coverage gate (mirrored in `coverage.thresholds` below).
 *
 * The first twelve are PURE directories. `src/identity-service`, `src/review-service`,
 * `src/integrity` and `src/integrity-service` are not: they are Postgres-backed (except
 * `src/integrity`, which is pure but joins the SAME reasoning below rather than the pure-twelve's),
 * and they are here because the final whole-branch review found that every one of its HIGH
 * findings lived in the service layer, which no gate measured. `src/integrity` and
 * `src/integrity-service` are a strictly stronger case than gates 13 and 14: they are the write
 * path for the audit record this whole phase exists to make trustworthy, and a gate that measures
 * everywhere except the write path measures the wrong place. A few guards in the service-layer
 * files are unreachable through real Postgres (a seeded row missing after an `ON CONFLICT DO
 * NOTHING`, an author vanishing behind a foreign key, `lockAnchor`'s "the row vanished between
 * insert and lock"); those are covered by narrow stub-`Db`/`DbTx` tests that put the code in the
 * state it defends against, never by lowering a threshold or ignoring a line.
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
const COVERAGE_GATED_DIRS = [
  "src/scoring",
  "src/draft-engine",
  "src/draft-room/state",
  "src/league",
  "src/chat",
  "src/matchmaking",
  "src/stats",
  "src/stats-pipeline",
  "src/identity",
  "src/help",
  "src/reviews",
  "src/gifs",
  "src/identity-service",
  "src/review-service",
  "src/integrity",
  "src/integrity-service",
  // Gates 17 and 18, recommended by name in Plan A's final whole-branch review
  // (`.superpowers/sdd/meta-loop.md`) for the same reason gates 13-16 exist: every
  // whole-branch review in this loop found its HIGH findings in the service layer, and
  // this plan writes into both directories (`join.ts`'s sweep trigger, `store.ts`'s
  // existing notice path).
  "src/league-service",
  "src/draft-service",
  // Gate 19. `src/moderation` is a new pure directory and gates for the reason every
  // pure directory does, and because it is the single home of the vocabulary that
  // decides what may be removed (ruling 21).
  "src/moderation",
] as const;
/**
 * The three service directories' `schemas.ts` files are named explicitly alongside the `**` glob
 * that already matches them. Redundant on purpose: those files are the Zod BOUNDARY every
 * request meets (`updateProfileSchema`'s sparse refine, `listReviewsQuerySchema`'s cursor
 * transform, `submitReviewSchema`'s superRefine, `markNoticesReadSchema`'s at-least-one-id
 * refine), they are the half of the service layer a reader is most likely to assume is "just
 * declarations" and exclude, and naming them here means narrowing any one directory's glob later
 * cannot silently drop them out of the gate.
 */
const coverageInclude = [
  ...COVERAGE_GATED_DIRS.map((dir) => `${dir}/**`),
  "src/identity-service/schemas.ts",
  "src/review-service/schemas.ts",
  "src/integrity-service/schemas.ts",
];

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "happy-dom",
    // Harness worktrees are nested checkouts — never collect their tests from the parent.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/.next/**", "e2e/**"],
    // Integration tests share one real Postgres/Redis and truncate between tests, so
    // test FILES must not interleave. Tests within a file already run sequentially.
    fileParallelism: false,
    // DB-backed files open a real Postgres pool in beforeEach/afterAll; under CPU pressure
    // (CI, capped Docker) the default 10s hook budget has flaked three times. Vitest's
    // defaults are 5s test / 10s hook — these are ceilings, not targets: a healthy run is
    // unaffected, and a genuinely hung hook still fails, just later.
    testTimeout: 15_000,
    hookTimeout: 30_000,
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
        "src/league/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/chat/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/matchmaking/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/stats/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/stats-pipeline/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/identity/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/help/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/reviews/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/gifs/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Gates 13 and 14. The twelve above cover PURE directories only, and the final review's
        // finding was that all five of its HIGHs lived in the service layer — "twelve gates,
        // 100%, all four metrics" was a true and strong statement about somewhere the defects
        // were not. These two directories own the review feed's write path and the identity
        // write path, and they are measured at the same bar as everything else.
        "src/identity-service/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/review-service/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Gates 15 and 16. `src/integrity` is pure and gates for the same reason every pure
        // directory does; `src/integrity-service` is Postgres-backed and gates for the reason
        // gates 13 and 14 do, and more so — this pair is the write path for the audit record this
        // whole phase exists to make trustworthy, and a gate that measures everywhere except the
        // write path measures the wrong place.
        "src/integrity/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/integrity-service/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Gates 17 and 18 — recommended by name in Plan A's final whole-branch review for
        // this plan. Guards unreachable through real Postgres get narrow stub-`Db` tests
        // that put the code in the state it defends against, the same discipline
        // `identity-service` and `integrity-service` already use.
        "src/league-service/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        "src/draft-service/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
        // Gate 19. `src/moderation` is pure and gates for the same reason every pure
        // directory does; it is the single home of the closed removal vocabulary
        // (ruling 21).
        "src/moderation/**": {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
});
