import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "../src/db/client";
import { statWeeks, users } from "../src/db/schema";
import { BOOTSTRAP_ACTOR, grantAdmin } from "../src/integrity-service/grant-admin";
import { LEAGUE_CONFIG } from "../src/league";
import { createRedisConnection } from "../src/lib/realtime/redis";
import { mintLabSession, SESSION_COOKIE_NAME } from "../scripts/lib/lab-session";

export const AUTH_DIR = resolve(process.cwd(), "e2e/.auth");
export const MANAGER_A_STATE = resolve(AUTH_DIR, "manager-a.json");
export const MANAGER_B_STATE = resolve(AUTH_DIR, "manager-b.json");
export const MANAGER_ZERO_STATE = resolve(AUTH_DIR, "manager-zero.json");
export const MANAGER_SIGNOUT_STATE = resolve(AUTH_DIR, "manager-signout.json");

// Stable, not secret: fixed WorkOS TEST-directory identities, minted once and reused on
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
// A third stable identity, warmed the same way as A and B (below) but never handed to the seed
// script (`DEV_SEED_CLAIM_USER_ID` names manager A only) and never joined to anything by any
// spec — `e2e/onboarding.spec.ts` only reads the fork and follows a link, it never creates or
// joins a league. That keeps this identity at zero leagues run over run, which is the one thing
// `onboarding.spec.ts` needs and neither `managerA` nor `managerB` can offer once seeded.
const MANAGER_ZERO_EMAIL = "e2e-manager-zero@commish-lab.test";
// A FOURTH stable identity, existing only to be signed out. Signing out ends the WorkOS session
// server-side, so a spec that signed out manager A, B or zero would revoke the session every
// other spec in the same run is holding — a coupling to Playwright's file ordering that would
// break the first time somebody renamed a spec. `mintLabSession` calls
// `authenticateWithPassword` on every run, so this identity gets a brand new session each time
// and the revocation costs the next run nothing.
const MANAGER_SIGNOUT_EMAIL = "e2e-manager-signout@commish-lab.test";
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
 * The safety net: a hard stop so a worker that can never converge fails the suite rather than
 * looping forever.
 */
const MAX_TICKS_TO_REACH_LIVE_WEEK = 40;

/**
 * The actual bound. A correct worker converges from a completely empty `stat_weeks` table in 13
 * ticks against the committed mock dataset's 16 games a week and the default 20-game tick budget:
 * a tick examining a brand new week finalizes it and starts the next, then a tick examining only
 * that week (the steady-state one-week window) finishes it. The safety net above cannot catch a
 * regression from 13 to 39 — it would pass, silently, while every real tick's request cost rose
 * with it. This is the assertion that fails instead: tight enough to notice, loose enough to
 * survive a dataset that grows a little.
 */
const EXPECTED_MAX_TICKS_TO_REACH_LIVE_WEEK = 15;

const LOCAL_REDIS_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * `resetIngestionRedisState`'s `stats:*` wildcard reset includes the request-budget ledger
 * itself (`stats:budget:*`, `@/stats-pipeline/budget.ts`) — the one thing `RequestBudget` is
 * deliberately designed to fail CLOSED to protect. Refusing to run it against anything but a
 * local Redis mirrors `assertLocalSeedTarget`'s idiom (`src/data/seed/guard.ts`, which the seed
 * step above already runs before this): a wildcard reset of a budget ledger has no business
 * running anywhere `.env.local` could plausibly point at something real.
 */
function assertLocalRedisTarget(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("Refusing to reset Redis: REDIS_URL could not be parsed, so the target cannot be verified as local.");
  }
  if (!LOCAL_REDIS_HOSTS.has(host)) {
    throw new Error(
      `Refusing to reset Redis: REDIS_URL points at "${host}", not a local Redis. This suite wildcard-clears every "stats:*" key, including the live request-budget ledger.`,
    );
  }
}

/**
 * Clears every `stats:*` key so a previous run's request-budget ledger can never deny THIS run's
 * reservations — the same reset `worker.test.ts` does in its own `beforeEach`, against the
 * shared dev Redis this suite reuses rather than a dedicated test instance. `REDIS_URL` is read
 * (and validated local) here rather than left to `createRedisConnection`'s own default: that
 * function already fails fast on an unset `REDIS_URL` — mirrored by reading it explicitly here —
 * but has no reason to also know this caller's local-only requirement.
 */
async function resetIngestionRedisState(): Promise<void> {
  const url = process.env.REDIS_URL;
  if (url === undefined || url === "") {
    throw new Error("Refusing to reset Redis: REDIS_URL is not set. Copy .env.example to .env.local and run `docker compose up -d`.");
  }
  assertLocalRedisTarget(url);

  const redis = createRedisConnection();
  try {
    const keys = await redis.keys("stats:*");
    if (keys.length > 0) await redis.unlink(...keys);
  } finally {
    redis.disconnect();
  }
}

/**
 * Clears `stat_weeks` (Postgres) so the ingestion worker's OWN "current week" — a separate,
 * global ledger from the season league's `matchups`-derived current week above — starts every
 * run from the same empty state, then ticks `scripts/ingest-once.ts` (with
 * `MOCK_STATS_LIVE_WEEK` overridden the same way `DEV_SEED_CLAIM_USER_ID` is above) until
 * `SEEDED_SEASON_CURRENT_WEEK` itself reports `in_progress` — deterministically, rather than
 * waiting out `STATS_INGESTION_CONFIG.pollIntervalMs` (30 minutes): a browser test that waits
 * half an hour is a browser test nobody runs.
 *
 * This is a real, unmodified exercise of `weeksToExamine`'s own cold-start-mid-season fix
 * (`@/stats-pipeline/worker.ts`): on a fresh table the worker starts at week 1 and, once every
 * EXISTING row is final, resumes at `MAX(week) + 1` rather than resetting to week 1 — so a burst
 * of ticks fired back-to-back correctly walks the whole season forward and converges on the live
 * week, with no backdoor Postgres write of any kind priming where it should resume.
 */
async function tickUntilLiveWeekReached(): Promise<void> {
  const db = createDb();
  try {
    await db.delete(statWeeks);

    for (let tick = 0; tick < MAX_TICKS_TO_REACH_LIVE_WEEK; tick++) {
      execFileSync(
        "npx",
        ["dotenv", "-e", ".env.local", "-v", `MOCK_STATS_LIVE_WEEK=${SEEDED_SEASON_CURRENT_WEEK}`, "--", "tsx", "scripts/ingest-once.ts"],
        { stdio: "inherit", cwd: resolve(AUTH_DIR, "../..") },
      );
      const [current] = await db.select({ status: statWeeks.status }).from(statWeeks).where(eq(statWeeks.week, SEEDED_SEASON_CURRENT_WEEK));
      if (current?.status === "in_progress") {
        const used = tick + 1;
        console.log(`[e2e] stats:ingest reached week ${SEEDED_SEASON_CURRENT_WEEK} in ${used} ticks`);
        if (used > EXPECTED_MAX_TICKS_TO_REACH_LIVE_WEEK) {
          throw new Error(
            `stats:ingest took ${used} ticks to reach week ${SEEDED_SEASON_CURRENT_WEEK}, past the expected bound of ${EXPECTED_MAX_TICKS_TO_REACH_LIVE_WEEK}. Convergence has regressed, and every tick costs upstream requests.`,
          );
        }
        return;
      }
    }

    throw new Error(`stats:ingest never reached week ${SEEDED_SEASON_CURRENT_WEEK} within ${MAX_TICKS_TO_REACH_LIVE_WEEK} ticks.`);
  } finally {
    await db.$client.end();
  }
}

/**
 * Makes manager A the operator, deterministically, on a database this suite does not control the
 * history of. `src/data/seed/index.ts`'s own `seedOperator` already tries this (`DEV_SEED_CLAIM_
 * USER_ID=a.userId`, run as part of the seed step below) — fix round 1, FIX 2's own finding is
 * that it can silently lose: `grantAdmin`'s bootstrap check is legal exactly once per database
 * (ruling 15), and a SHARED dev database that was ever seeded once before without a claim id (or
 * seeded by a different developer, or reseeded after `scripts/grant-admin.ts` was run by hand)
 * already has `dev_user_01` or someone else holding that one bootstrap slot — `seedOperator`'s own
 * call then answers `{ ok: false, reason: "This database already has an operator…" }`, silently,
 * and manager A is never admin. `e2e/mobile-360.spec.ts`'s queue assertions then either 404 (if
 * they check for that) or — the actual failure mode found in review — pass VACUOUSLY, because
 * nothing upstream noticed the grant never landed.
 *
 * This is the fix: read whether manager A is ALREADY an operator (the common case on a reused
 * database, after this function's own first run) and return immediately if so — zero writes on
 * every rerun but the first. Otherwise, find ANY existing operator and grant THROUGH them
 * (`grantAdmin`'s ordinary, non-bootstrap door — the same one `scripts/grant-admin.ts` uses for
 * every grant after the first), falling back to `BOOTSTRAP_ACTOR` only when the database
 * genuinely has no operator yet. Never a direct `UPDATE users SET is_admin` — `grantAdmin` is
 * still the ONLY writer of that column (ruling 15, `seed-operator.test.ts`'s own drift tripwire),
 * and this function calls it exactly the way the interactive script would if a human ran it with
 * `--by <the first admin's id>`.
 *
 * Throws (rather than swallowing) if `grantAdmin` still refuses — a concurrent grant/revoke
 * racing this setup is the only way that could happen, and a loud failure here is better than a
 * mobile spec silently skipping its own operator assertions a second time.
 */
async function ensureE2eOperator(db: Db, targetUserId: string): Promise<void> {
  const [target] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, targetUserId));
  if (target?.isAdmin === true) return;

  const [existingAdmin] = await db.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).limit(1);
  const grantedBy = existingAdmin?.id ?? BOOTSTRAP_ACTOR;

  const result = await grantAdmin(db, { userId: targetUserId, grant: true, grantedBy });
  if (!result.ok) {
    throw new Error(`[e2e] could not make ${targetUserId} the operator (granting through "${grantedBy}"): ${result.reason}`);
  }
  console.log(`[e2e] granted operator access to ${targetUserId} (through "${grantedBy}")`);
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
 * 4. **Reset** the ingestion worker's Redis state (`resetIngestionRedisState`) and **tick** it,
 *    deterministically and repeatedly, until the live week is reached (`tickUntilLiveWeekReached`
 *    — see its own docblock). This is what makes `e2e/live-scoring.spec.ts`'s "week in progress"
 *    state real rather than mocked.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? "http://localhost:3100";

  const [a, b, zero, signOut] = await Promise.all([
    mintLabSession({ email: MANAGER_A_EMAIL, password: MANAGER_PASSWORD }),
    mintLabSession({ email: MANAGER_B_EMAIL, password: MANAGER_PASSWORD }),
    mintLabSession({ email: MANAGER_ZERO_EMAIL, password: MANAGER_PASSWORD }),
    mintLabSession({ email: MANAGER_SIGNOUT_EMAIL, password: MANAGER_PASSWORD }),
  ]);

  mkdirSync(AUTH_DIR, { recursive: true });
  // Bearer credentials on disk: same 0600 treatment the mint script gives its own output.
  writeFileSync(MANAGER_A_STATE, storageState(baseURL, a.cookie), { mode: 0o600 });
  writeFileSync(MANAGER_B_STATE, storageState(baseURL, b.cookie), { mode: 0o600 });
  writeFileSync(MANAGER_ZERO_STATE, storageState(baseURL, zero.cookie), { mode: 0o600 });
  writeFileSync(MANAGER_SIGNOUT_STATE, storageState(baseURL, signOut.cookie), { mode: 0o600 });

  const browser = await chromium.launch();
  try {
    for (const state of [MANAGER_A_STATE, MANAGER_B_STATE, MANAGER_ZERO_STATE, MANAGER_SIGNOUT_STATE]) {
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

  // 3.5. **Make manager A the operator, for real** — the seed step above already tried
  // (`seedOperator`), and this is what makes it deterministic on a shared database where that
  // attempt can silently lose (see `ensureE2eOperator`'s own docblock, fix round 1 FIX 2).
  const operatorDb = createDb();
  try {
    await ensureE2eOperator(operatorDb, a.userId);
  } finally {
    await operatorDb.$client.end();
  }

  await resetIngestionRedisState();
  await tickUntilLiveWeekReached();
}
