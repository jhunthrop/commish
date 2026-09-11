import "@testing-library/jest-dom/vitest";
import { afterEach, expect } from "vitest";
import { cleanup } from "@testing-library/react";
import * as axeMatchers from "vitest-axe/matchers";
import type { AxeMatchers } from "vitest-axe/matchers";
import { currentTestDbLane, testDatabaseUrlForLane } from "@/db/test-lanes";

// vitest.config.mts sets `globals: false`, so @testing-library/react's automatic
// afterEach(cleanup) (which relies on global test hooks) never registers. Register
// it once here so every RTL test file unmounts between tests without boilerplate.
afterEach(() => {
  cleanup();
});

// THE LANE REWRITE (Round D, Task 3 scope extension — the one-runner era ends). `setupFiles` run
// before EVERY test file loads, which is earlier than any test file's own module-scope code (its
// `vi.hoisted` blocks included) — so this is the ONE place the lane rewrite needs to happen for
// the whole suite to pick it up. Roughly 35 route-handler test files read
// `process.env.TEST_DATABASE_URL` directly (to point the code UNDER TEST, which builds its own
// `DATABASE_URL`-driven connection, at the same physical database their own `createTestDb()`
// call reads) rather than importing `test-db.ts`'s exported constant — rewriting the env var
// itself, once, here, means every one of those files gets lane-correct routing for free, with no
// per-file change and no chance of the rule drifting between whichever files remembered to apply
// it. `test-db.ts`'s own `TEST_DATABASE_URL` export reads through `envOr` at import time, which
// happens after this file has already run, so it resolves to the SAME rewritten value.
//
// CACHED THROUGH A SENTINEL ENV VAR, DELIBERATELY: `isolate: true` (the default) re-imports this
// setup file's module graph fresh for every test file in the worker, but `process.env` itself is
// the SAME process-wide object across every file a worker runs — so a naive
// `testDatabaseUrlForLane(process.env.TEST_DATABASE_URL, lane)` on file 2 would rewrite the
// ALREADY-rewritten value from file 1 a second time (`commish_test_2` growing an extra `_2`
// suffix into `commish_test_2_2`). The sentinel remembers the pristine base URL the first time
// this file runs in a given worker so every later run in that same worker rewrites from the same
// origin rather than from its own prior output.
process.env.__TEST_DATABASE_BASE_URL__ ??= process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
process.env.TEST_DATABASE_URL = testDatabaseUrlForLane(process.env.__TEST_DATABASE_BASE_URL__, currentTestDbLane());

// `npm test` is plain `vitest run` — nothing here loads `.env.local` the way `next dev`/`next
// build` do or `dotenv -e .env.local --` does for the scripts that need it. `TEST_DATABASE_URL`
// gets away with this because `createTestDb` (`src/db/test-db.ts`) reads it through `envOr` with
// a hardcoded fallback matching docker-compose's defaults. `SESSION_SIGNAL_SALT`
// (`src/integrity-service/session-signals.ts`) intentionally has NO such fallback in production
// code — a salt that silently defaults to a constant is a salt that does nothing — so the
// equivalent fallback lives here instead, set once for the whole suite rather than duplicated
// into every test file that exercises `recordSessionSignals`/`syncUserFromWorkOS`. `??=` leaves a
// real value from the environment untouched if one is ever exported before the run.
process.env.SESSION_SIGNAL_SALT ??= "vitest-suite-session-signal-salt-not-for-any-real-use";

// `REDIS_URL`, for the same reason and by the same rule, pointed at the same docker-compose
// service every Redis-backed test already reaches for by hand
// (`src/stats-pipeline/score-cache.test.ts` and friends open `process.env.REDIS_URL ??
// "redis://localhost:6379"` themselves). It is here now because the reaction ceiling
// (`src/app/api/leagues/_reaction-limit.ts`) FAILS CLOSED: a route that cannot reach the ledger
// refuses rather than guessing, so an unset `REDIS_URL` would make every reaction test a 503
// about the test environment rather than about the product. Production always has one — the SSE
// stream cannot run without it — so the suite having one too is the environment matching the
// shape the code is written for, not a special case for it.
process.env.REDIS_URL ??= "redis://localhost:6379";

// vitest-axe@0.1.0's own "vitest-axe/extend-expect" entry point ships an empty
// dist/extend-expect.js (a broken build published to npm — verified against the
// registry tarball, not an install artifact of this machine) and its .d.ts targets
// vitest's pre-1.0 `declare global { namespace Vi { ... } }` typing pattern, which
// current vitest (module-augmentation-based `declare module "vitest"`) no longer
// picks up. Register the matcher at runtime and re-declare its type ourselves,
// mirroring the pattern @testing-library/jest-dom/vitest uses.
expect.extend(axeMatchers);

declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type, @typescript-eslint/no-unused-vars -- declaration-merging interface must match vitest's own `Assertion<T = any>` signature exactly
  interface Assertion<T = any> extends AxeMatchers {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merging interface, adds no new members by design
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}
