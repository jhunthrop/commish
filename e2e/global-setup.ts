import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import Redis from "ioredis";
import { createDb } from "../src/db/client";
import { statWeeks } from "../src/db/schema";
import { LEAGUE_CONFIG } from "../src/league";
import { STATS_INGESTION_CONFIG } from "../src/stats-pipeline/config";
import { mintLabSession, SESSION_COOKIE_NAME } from "../scripts/lib/lab-session";

export const AUTH_DIR = resolve(process.cwd(), "e2e/.auth");
export const MANAGER_A_STATE = resolve(AUTH_DIR, "manager-a.json");
export const MANAGER_B_STATE = resolve(AUTH_DIR, "manager-b.json");

// Stable, not secret: two fixed WorkOS TEST-directory identities, minted once and reused on
// every rerun (`mintLabSession`'s mint-if-absent path). A fresh random identity per run used to
// be minted here, which collided with the seed's OWN first-claim-sticks rule
// (`src/data/seed/dev-users.ts`'s `preserveRealTeamOwner`): run 1 claims the seeded season
// league's team 1 for identity A1 and that claim sticks forever, but run 2 minted a brand new
// A2, seeded with A2 as the claim id (a no-op, since team 1 already belongs to A1), and then
// authenticated the browser AS A2, a manager whose session no longer matches the team the
// seed handed them. `season.spec.ts` then failed to find its own commissioner controls. A
// stable identity makes every run's claim id the SAME as the one that stuck on run 1.
const MANAGER_A_EMAIL = "e2e-manager-a@commish-lab.test";
const MANAGER_B_EMAIL = "e2e-manager-b@commish-lab.test";
const MANAGER_PASSWORD = "E2e-Manager-Lab-Password-1!";

function storageState(baseURL: string, cookie: string): string {
  const { hostname } = new URL(baseURL);
  return JSON.stringify({
    cookies: [
      {
        name: SESSION_COOKIE_NAME,
        value: cookie,
        domain: hostname,
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  });
}

/**
 * `seedSeasonLeague` (`src/data/seed/seed-season-league.ts`) scores every week of the seeded
 * season directly, so its own `matchups` rows already make this the league's current week —
 * see `currentWeekNumber` (`src/league/schedule.ts`): once every week has both scores in,
 * "current" falls to the last one.
 */
export const SEEDED_SEASON_CURRENT_WEEK = LEAGUE_CONFIG.regularSeasonWeeks;

/**
 * The live-scoring worker's own "current week" is a SEPARATE, global `stat_weeks` ledger
 * (`weeksToExamine`, `@/stats-pipeline/worker.ts`): a tick examines the `maxWeeksPerTick` weeks
 * starting from the EARLIEST week that has a row and isn't `final` — falling back to week 1 only
 * when NO such row exists at all. In production that pointer walks forward naturally: a week
 * gets a `scheduled` row long before it's `final` (its games haven't happened yet on the
 * calendar), and that row is what keeps the pointer from resetting once the week before it
 * finalizes. A burst of ticks fired back-to-back against the mock has no such row: every
 * non-live week reports `final` on the very FIRST tick that examines it (`statusFor`,
 * `mock-stats-provider.ts`), so once weeks 1–2 both land `final` with nothing else in the
 * table, `weeksToExamine` finds no non-final row anywhere and resets to week 1 forever — proven
 * empirically (seven ticks in a row never moved past week 2).
 *
 * `resetIngestionState` below plants the ONE thing production would have grown naturally: a
 * `scheduled` placeholder row at the last week the window before the live week needs, so the
 * very next tick's window lands exactly on `[..., SEEDED_SEASON_CURRENT_WEEK]`. This is not
 * faking the worker's result — the tick that follows still does the real work (a real
 * `provider.listGames`, a real `persistTick`) — it only supplies the calendar-time fact a
 * single burst of ticks can't otherwise produce.
 */
const RESUME_POINTER_WEEK = SEEDED_SEASON_CURRENT_WEEK - (STATS_INGESTION_CONFIG.maxWeeksPerTick - 1);

/**
 * Resets both stores the ingestion worker owns, so this run's single tick (below) starts from
 * exactly `RESUME_POINTER_WEEK` regardless of what an earlier run (or a developer's own `npm
 * run dev`) left behind in the shared dev Postgres/Redis this suite reuses rather than a
 * dedicated test instance:
 *
 * - `stat_weeks` (Postgres) is cleared and given exactly one row, at `RESUME_POINTER_WEEK`,
 *   `scheduled` — see `RESUME_POINTER_WEEK`'s own docblock for why.
 * - `stats:*` (Redis) is cleared so a previous run's request-budget ledger
 *   (`stats:budget:*`, `@/stats-pipeline/budget.ts`) can never deny this run's reservation, the
 *   same reset `worker.test.ts` does in its own `beforeEach`.
 */
async function resetIngestionState(): Promise<void> {
  const db = createDb();
  try {
    await db.delete(statWeeks);
    await db.insert(statWeeks).values({ week: RESUME_POINTER_WEEK });
  } finally {
    await db.$client.end();
  }

  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  try {
    const keys = await redis.keys("stats:*");
    if (keys.length > 0) await redis.unlink(...keys);
  } finally {
    redis.disconnect();
  }
}

/**
 * Two real managers, one seeded season, its live week ticked into progress, no bypass.
 *
 * The order matters and each step earns its place:
 *
 * 1. **Mint** two WorkOS test-directory sessions for the two STABLE identities above
 *    (mint-if-absent: created on the first run, reused on every rerun). This throws with a
 *    named variable if the WorkOS test credentials are absent — a loud stop, never a silently
 *    skipped suite.
 * 2. **Warm** each session by loading `/app` once. That is what makes `getCurrentUser()` write
 *    the local `users` row, and step 3 has a foreign key onto it. Doing it through the real
 *    page rather than a direct insert is the whole point: if identity sync is broken, the e2e
 *    suite should fail here rather than paper over it.
 * 3. **Seed** with manager A's id as `DEV_SEED_CLAIM_USER_ID`, so A owns team 1 and the
 *    commissioner's chair in the seeded season league and can actually score a week.
 * 4. **Reset** the ingestion worker's own state (`resetIngestionState`) and **tick** it exactly
 *    ONCE — its underlying script directly, so `MOCK_STATS_LIVE_WEEK` can be overridden the same
 *    way `DEV_SEED_CLAIM_USER_ID` is above — deterministically, rather than waiting out
 *    `STATS_INGESTION_CONFIG.pollIntervalMs` (30 minutes): a browser test that waits half an
 *    hour is a browser test nobody runs. This is what makes `e2e/live-scoring.spec.ts`'s "week
 *    in progress" state real rather than mocked.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3100";

  const [a, b] = await Promise.all([
    mintLabSession({ email: MANAGER_A_EMAIL, password: MANAGER_PASSWORD }),
    mintLabSession({ email: MANAGER_B_EMAIL, password: MANAGER_PASSWORD }),
  ]);

  mkdirSync(AUTH_DIR, { recursive: true });
  // Bearer credentials on disk: same 0600 treatment the mint script gives its own output.
  writeFileSync(MANAGER_A_STATE, storageState(baseURL, a.cookie), { mode: 0o600 });
  writeFileSync(MANAGER_B_STATE, storageState(baseURL, b.cookie), { mode: 0o600 });

  const browser = await chromium.launch();
  try {
    for (const state of [MANAGER_A_STATE, MANAGER_B_STATE]) {
      const context = await browser.newContext({ storageState: state, baseURL });
      const page = await context.newPage();
      const response = await page.goto("/app", { waitUntil: "domcontentloaded" });
      if (response === null || response.status() >= 400) {
        throw new Error(`Session warm-up failed for ${state}: /app answered ${response?.status() ?? "no response"}.`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  // `-v` rather than an inherited env var: `npm run seed` runs under `dotenv -e .env.local`,
  // and `.env.local` sets DEV_SEED_CLAIM_USER_ID itself. `-v` is the spelling this repo
  // already uses for exactly this override (see the `db:migrate:test` script).
  execFileSync(
    "npx",
    ["dotenv", "-e", ".env.local", "-v", `DEV_SEED_CLAIM_USER_ID=${a.userId}`, "--", "tsx", "src/data/seed/index.ts"],
    { stdio: "inherit", cwd: resolve(AUTH_DIR, "../..") },
  );

  await resetIngestionState();
  execFileSync(
    "npx",
    ["dotenv", "-e", ".env.local", "-v", `MOCK_STATS_LIVE_WEEK=${SEEDED_SEASON_CURRENT_WEEK}`, "--", "tsx", "scripts/ingest-once.ts"],
    { stdio: "inherit", cwd: resolve(AUTH_DIR, "../..") },
  );
}
