import { defineConfig, devices } from "@playwright/test";
import { envOr } from "@research-ts/lib/env";

// DEVIATION from the original spec: port 3000 is occupied by another developer's live `next
// dev` server on this machine, and this suite must never touch it. The default here is 3100,
// not 3000 — set E2E_BASE_URL to point elsewhere. The port is also threaded into the
// `webServer.command` below so `next start` listens on the same port `baseURL` points at.
// `envOr`, not `??`: `.env.example` ships `E2E_BASE_URL=` (an intentionally empty line, so a
// fresh `.env.local` copy documents the var without forcing a value), and dotenv-cli sets
// `process.env.E2E_BASE_URL` to `""` for that line — `??` only catches `undefined`/`null`, so
// an empty string would defeat the fallback and `new URL("")` below would throw.
const BASE_URL = envOr("E2E_BASE_URL", "http://localhost:3100");
const PORT = new URL(BASE_URL).port || "3100";

// A `next dev` process can be running against this same checkout at the same time as this
// suite (both default to `.next`); its HMR writes corrupt `next start`'s asset manifest out
// from under it. Isolate the e2e build/serve in its own dist dir (see next.config.ts).
//
// `npm run e2e` BUILDS this directory before it tests (the `e2e:build` script). It did not used
// to, and the resulting foot-gun cost a full day: `webServer.command` is `next start`, which
// serves whatever bundle is already on disk, so a source fix that was committed, type-checked
// and unit-tested still did not reach the suite. Three consecutive runs "confirmed" a bug that
// had already been fixed, because the running server predated the fix. If you ever run
// `playwright test` directly instead of through `npm run e2e`, build first or you are testing
// the past: `npm run e2e:build`.
const NEXT_DIST_DIR = ".next-e2e";

/**
 * The e2e suite runs against the REAL stack: the production build of this app, the real
 * docker-compose Postgres and Redis, and a real WorkOS test-directory session. Nothing is
 * mocked and no auth bypass exists — see `scripts/lib/lab-session.ts`.
 *
 * One worker, no parallelism: every spec shares one database and one seeded dataset, exactly
 * like the Vitest suite's `fileParallelism: false`. Two specs scoring the same week at once
 * would race the same rows and flake for a reason that has nothing to do with the product.
 */
export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: process.env.CI !== undefined,
  // One retry in CI only: a genuine product failure repeats, while a cold-start timeout on a
  // shared runner does not. Locally, a failure should stay failed.
  retries: process.env.CI !== undefined ? 1 : 0,
  reporter: process.env.CI !== undefined ? [["github"], ["html", { open: "never" }]] : [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Every spec but `mobile-360.spec.ts` — that file's own tests already set a 360px viewport
    // per `browser.newContext(...)` call (it needs a specific `storageState` alongside the
    // width, which a project's own default `use.viewport` cannot supply per-test), so it is
    // carved out here rather than run twice.
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile-360\.spec\.ts$/ },
    // Task 13's second viewport project (plan Task 13 Files list): 360px is a first-class
    // target for this suite, not an incidental override buried inside one spec file's own
    // `newContext` calls — declaring it here is what makes `mobile-360.spec.ts` runnable on its
    // own project (`playwright test --project=mobile-360`) with the width as its own default,
    // exactly like `chromium` above declares Desktop Chrome as ITS default.
    { name: "mobile-360", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 740 } }, testMatch: /mobile-360\.spec\.ts$/ },
  ],
  webServer: {
    // `next start`, not `next dev`: an e2e run should exercise what a deploy would serve, and
    // dev-mode compilation on first hit is the single largest source of e2e timeout flake.
    command: `npm run start -- -p ${PORT}`,
    url: BASE_URL,
    // NEVER reuse, in CI or out. `e2e:build` has just written a fresh bundle, and a server that
    // was already listening on this port is serving the previous one — reuse would hand that
    // stale process the run and quietly undo the build. Starting fresh costs about a second;
    // testing the wrong bundle costs a day. If the port is busy, Playwright says so loudly,
    // which is the outcome we want over a silent pass against old code.
    reuseExistingServer: false,
    timeout: 180_000,
    // The suite's own leagues are named `E2E …`/`Mobile360…`, which is exactly what
    // `notAFixtureLeague()` (`@/league-service/browse`) hides from every public read so the
    // founder's shelf never shows seeded junk. These specs join THROUGH the real front door, so
    // this server — and only this server — asks to see them. Safe because it is per-process, not
    // per-database: the founder's `next dev` on :3000 never reads this value.
    env: { NEXT_DIST_DIR, E2E_SHOW_FIXTURE_LEAGUES: "1" },
  },
});
