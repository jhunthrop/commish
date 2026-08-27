import { defineConfig, devices } from "@playwright/test";
import { envOr } from "@/lib/env";

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
// from under it. Isolate the e2e build/serve in its own dist dir (see next.config.ts). The
// `npm run build` step in the README/brief for this suite must set the same var:
// `NEXT_DIST_DIR=.next-e2e npm run build`.
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
    reuseExistingServer: process.env.CI === undefined,
    timeout: 180_000,
    // The suite's own leagues are named `E2E …`/`Mobile360…`, which is exactly what
    // `notAFixtureLeague()` (`@/league-service/browse`) hides from every public read so the
    // founder's shelf never shows seeded junk. These specs join THROUGH the real front door, so
    // this server — and only this server — asks to see them. Safe because it is per-process, not
    // per-database: the founder's `next dev` on :3000 never reads this value.
    env: { NEXT_DIST_DIR, E2E_SHOW_FIXTURE_LEAGUES: "1" },
  },
});
