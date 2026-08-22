import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { eq, sql } from "drizzle-orm";
import { assembleAdvisorContext } from "../src/ai-advisor/context";
import { createDb, type Db } from "../src/db/client";
import { drafts, leagueInvites, leagues, matchups, rosterSlots, scoringSettings, statWeeks, teams, users } from "../src/db/schema";
import { STANDARD_ROSTER_SLOTS, type RosterSlotType } from "../src/domain/roster";
import { PPR_SCORING } from "../src/domain/scoring";
import { assignSlot, snakeTeamForPick, totalRosterSlots } from "../src/draft-engine";
import { rankedPlayers } from "../src/draft-service/pool";
import { BOOTSTRAP_ACTOR, grantAdmin } from "../src/integrity-service/grant-admin";
import { INTEGRITY_CONFIG } from "../src/integrity/config";
import { LEAGUE_CONFIG } from "../src/league";
import { createInvite } from "../src/league-service/invites";
import { createRedisConnection } from "../src/lib/realtime/redis";
import { TRADE_CONFIG } from "../src/trades/config";
import { mintLabSession, SESSION_COOKIE_NAME } from "../scripts/lib/lab-session";

export const AUTH_DIR = resolve(process.cwd(), "e2e/.auth");
export const MANAGER_A_STATE = resolve(AUTH_DIR, "manager-a.json");
export const MANAGER_B_STATE = resolve(AUTH_DIR, "manager-b.json");
export const MANAGER_C_STATE = resolve(AUTH_DIR, "manager-c.json");
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
// A third stable identity (Phase 3 Plan C, Task 9): `e2e/trades.spec.ts` needs a genuine
// third team in its own seeded league — a member who never proposed or answered the trade —
// to prove the league activity feed shows the trade to a bystander and shows them nothing
// about the fairness flag it raises. Warmed and joined the identical way A and B are; never
// handed to the seed script (only manager A claims a team through `DEV_SEED_CLAIM_USER_ID`).
const MANAGER_C_EMAIL = "e2e-manager-c@commish-lab.test";
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

// ---------------------------------------------------------------------------------------------
// `e2e/trades.spec.ts`'s own league (Phase 3 Plan C, Task 9): the per-spec-seeding item the
// binding context calls out by name, greenlit for THIS spec specifically rather than deferred to
// the Plan-C backlog. A trade spec needs a league that has already drafted, with two managers
// holding known players — bolting three more steps onto `league-lifecycle.spec.ts` would make
// both specs slower and each one's failure ambiguous (that spec's own docblock already declined a
// full draft for the identical reason). This seeds it directly, in the database, the same way
// this file already seeds the season league's live week — scaffolding, not the tested surface;
// the trade arc itself (Task 9's own e2e assertions) is driven entirely through the hydrated UI.
// ---------------------------------------------------------------------------------------------

export const E2E_TRADES_LEAGUE_ID = "e2e_trades_league";
const E2E_TRADES_DRAFT_ID = "e2e_trades_draft";
export const E2E_TRADES_TEAM_A_ID = "e2e_trades_team_a";
export const E2E_TRADES_TEAM_B_ID = "e2e_trades_team_b";
export const E2E_TRADES_TEAM_C_ID = "e2e_trades_team_c";
/**
 * `LEAGUE_CONFIG.maxWeeks` (18), the same choice `src/data/seed/seed-trades.ts` makes and for
 * the identical reason (see that file's own docblock): `stat_weeks` is GLOBAL, and this file's
 * own `tickUntilLiveWeekReached` walks the real ingestion worker forward on every run, which can
 * push it past `regularSeasonWeeks` (14) over many accumulated runs against a long-lived dev
 * database. The worker cannot walk past week 17 no matter how many times it runs — the committed
 * mock dataset's own last week IS 17 — so `maxWeeks` (18) is safe forever, not just today.
 */
export const E2E_TRADES_WEEK_NUMBER = LEAGUE_CONFIG.maxWeeks;

/** Which real players `e2e/trades.spec.ts` builds its offer around — WRITTEN here, never
 *  guessed there. See `writeTradesFixture`'s own docblock for why. */
export const E2E_TRADES_FIXTURE_STATE = resolve(AUTH_DIR, "trades-fixture.json");

export interface TradesFixture {
  /** Manager A's own names, in the order this spec should give them away. */
  readonly giveNames: readonly string[];
  /** Manager B's own names, in the order this spec should ask for them. */
  readonly getNames: readonly string[];
}

/**
 * Deal each team ONLY its nine starting slots (`STANDARD_ROSTER_SLOTS` minus `BENCH`) — the
 * bench stays entirely empty, on purpose. Every roster this league ever carries therefore has six
 * open slots that accept ANY position, so `e2e/trades.spec.ts` can build an offer around whichever
 * players the draft actually dealt (never a name this file has to predict) and `plannedTransfer`'s
 * real legality check always finds room for what comes back, on both sides, without this file
 * needing to simulate it. A starting QB traded away for a division-mate's DEF/K pair prices
 * lopsided enough to cross `INTEGRITY_CONFIG.trade.fairnessFlagThreshold` on the real scoring
 * scale (PPR's own QB/K/DEF spread) without hand-picking specific player ids at all.
 */
const STARTER_ONLY_SLOTS = STANDARD_ROSTER_SLOTS.filter((slot) => slot.slot !== "BENCH");

/**
 * `dealRostersIfAbsent` (`src/data/seed/seed-trades.ts`)'s own discipline, inlined rather than
 * imported: this file seeds a league keyed to REAL WorkOS ids only known at Playwright's own
 * runtime, so it cannot reuse that module's dev-placeholder-user machinery — but the "walk a
 * snake order over `rankedPlayers`, ask the engine's own `assignSlot` where each player fits"
 * shape is identical, and re-running never re-deals a roster that already exists: a re-deal on a
 * rerun would silently un-trade whatever a PRIOR run's own trade already moved (this league's
 * trade is reversed by the end of a successful spec run, but a run that failed mid-arc must not
 * have its fixture reset out from under a re-run's own assumptions either).
 */
async function ensureTradesLeague(db: Db, managerAUserId: string, managerBUserId: string, managerCUserId: string): Promise<void> {
  const teamIds: readonly string[] = [E2E_TRADES_TEAM_A_ID, E2E_TRADES_TEAM_B_ID, E2E_TRADES_TEAM_C_ID];
  const owners: readonly string[] = [managerAUserId, managerBUserId, managerCUserId];

  await db
    .insert(leagues)
    .values({
      id: E2E_TRADES_LEAGUE_ID,
      name: "E2E Trades League",
      format: "snake",
      teamCount: teamIds.length,
      commissionerUserId: managerAUserId,
      rosterSlots: [...STANDARD_ROSTER_SLOTS],
    })
    .onConflictDoUpdate({ target: leagues.id, set: { commissionerUserId: managerAUserId } });

  await db.insert(scoringSettings).values({ leagueId: E2E_TRADES_LEAGUE_ID, ...PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(teamIds.map((id, i) => ({ id, leagueId: E2E_TRADES_LEAGUE_ID, userId: owners[i], name: `E2E Trade Team ${i + 1}` })))
    .onConflictDoUpdate({ target: teams.id, set: { userId: sql`excluded.user_id` } });

  await db
    .insert(drafts)
    .values({ id: E2E_TRADES_DRAFT_ID, leagueId: E2E_TRADES_LEAGUE_ID, format: "snake", status: "complete", kickoffAt: new Date(), auctionBudget: null })
    .onConflictDoNothing({ target: drafts.id });

  // ONE unscored matchup is what makes `seasonProgress`/`currentWeekNumber` (`@/league/schedule`)
  // answer `E2E_TRADES_WEEK_NUMBER` for THIS league's own "current week" — a schedule-less league
  // defaults to week 1 (which, after `tickUntilLiveWeekReached` below, is globally `final`).
  // Home vs away, never both directions: `matchups`' own primary key is
  // `(league_id, week_number, home_team_id)`, so this row alone is enough for `leagueHome` and
  // `matchupWeek` to both resolve teams A and B's rosters for the trade page.
  await db
    .insert(matchups)
    .values({ leagueId: E2E_TRADES_LEAGUE_ID, weekNumber: E2E_TRADES_WEEK_NUMBER, homeTeamId: E2E_TRADES_TEAM_A_ID, awayTeamId: E2E_TRADES_TEAM_B_ID })
    .onConflictDoNothing();

  const [existingRoster] = await db.select({ teamId: rosterSlots.teamId }).from(rosterSlots).where(eq(rosterSlots.teamId, E2E_TRADES_TEAM_A_ID)).limit(1);
  if (existingRoster === undefined) {
    const pool = await rankedPlayers(db, E2E_TRADES_LEAGUE_ID);
    const taken = new Set<string>();
    const rosters = new Map(teamIds.map((id) => [id, [] as { slot: RosterSlotType; slotIndex: number; playerId: string }[]]));
    const totalPicks = teamIds.length * totalRosterSlots(STARTER_ONLY_SLOTS);

    for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber++) {
      const teamId = snakeTeamForPick(teamIds, pickNumber);
      const roster = rosters.get(teamId)!;
      const sizeBefore = roster.length;
      for (const player of pool) {
        if (taken.has(player.id)) continue;
        const assignment = assignSlot({ position: player.position, roster, slotConfig: STARTER_ONLY_SLOTS });
        if (!assignment.ok) continue;
        taken.add(player.id);
        roster.push({ slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: player.id });
        break;
      }
      if (roster.length === sizeBefore) {
        throw new Error(`[e2e] ensureTradesLeague: no eligible player left in the pool for pick ${pickNumber} (team ${teamId}).`);
      }
    }

    const slotRows = [...rosters.entries()].flatMap(([teamId, slots]) => slots.map((slot) => ({ teamId, ...slot })));
    await db.insert(rosterSlots).values(slotRows);
  }

  await writeTradesFixture(db);
}

interface StarterCandidate {
  readonly teamId: string;
  readonly playerId: string;
  readonly name: string;
  readonly averagePoints: number;
}

/** Every way to choose exactly `size` items from `items`, order-independent — the identical
 *  combinatorial shape `bestBenchCombo` (`src/data/seed/seed-trades.ts`) already keeps, not
 *  reinvented, just against these nine-player STARTER rosters instead of a six-player bench. */
function combinationsOfSize<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const [head, ...rest] = items;
  const withHead = combinationsOfSize(rest, size - 1).map((combo) => [head!, ...combo]);
  const withoutHead = combinationsOfSize(rest, size);
  return [...withHead, ...withoutHead];
}

function sumPoints(players: readonly StarterCandidate[]): number {
  return players.reduce((total, player) => total + player.averagePoints, 0);
}

/**
 * Writes the ONE thing `e2e/trades.spec.ts` is not allowed to guess: which of manager A's real,
 * just-dealt players to give, and which of manager B's to ask for, so the trade this spec
 * proposes is grotesque enough to raise a real `trade_fairness` flag (Task 9's own binding
 * context — a real flag from a real detector, never a decorative one). Computed here, against the
 * real rosters this function just dealt, valued the exact way `evaluateTradeBeforeExecute` itself
 * will value them a moment later (`assembleAdvisorContext`) — never a hand-typed pair of names
 * that could drift the moment the committed dataset or the draft order changes. `prefer: "max"`
 * (mirroring `seedTrades`' own grotesque fixture): the widest gap available, not merely the first
 * one past the threshold, so a borderline roll of the snake draft can never leave this fixture
 * sitting just under `INTEGRITY_CONFIG.trade.fairnessFlagThreshold`.
 *
 * Legal by construction, for the identical reason `STARTER_ONLY_SLOTS` leaves every bench slot
 * empty: whatever count either side gives, the other's six wide-open bench slots always have
 * room for it, so this never needs to simulate `plannedTransfer` to know the answer it writes is
 * one the real route will actually accept.
 */
async function writeTradesFixture(db: Db): Promise<void> {
  const [contextA, contextB] = await Promise.all([
    assembleAdvisorContext(db, { leagueId: E2E_TRADES_LEAGUE_ID, teamId: E2E_TRADES_TEAM_A_ID, weekNumber: E2E_TRADES_WEEK_NUMBER }),
    assembleAdvisorContext(db, { leagueId: E2E_TRADES_LEAGUE_ID, teamId: E2E_TRADES_TEAM_B_ID, weekNumber: E2E_TRADES_WEEK_NUMBER }),
  ]);
  if (contextA === null || contextB === null) {
    throw new Error("[e2e] writeTradesFixture: manager A or B's team doesn't resolve in the trades league yet.");
  }
  const teamAPlayers: readonly StarterCandidate[] = contextA.me.players.map((p) => ({ teamId: E2E_TRADES_TEAM_A_ID, playerId: p.playerId, name: p.name, averagePoints: p.averagePoints }));
  const teamBPlayers: readonly StarterCandidate[] = contextB.me.players.map((p) => ({ teamId: E2E_TRADES_TEAM_B_ID, playerId: p.playerId, name: p.name, averagePoints: p.averagePoints }));

  let best: { readonly give: readonly StarterCandidate[]; readonly get: readonly StarterCandidate[]; readonly gap: number } | null = null;
  const maxSize = Math.min(5, teamAPlayers.length, teamBPlayers.length);
  for (let size = 1; size <= maxSize; size++) {
    for (const give of combinationsOfSize(teamAPlayers, size)) {
      const giveSum = sumPoints(give);
      for (const get of combinationsOfSize(teamBPlayers, size)) {
        const gap = Math.abs(giveSum - sumPoints(get));
        if (gap < INTEGRITY_CONFIG.trade.fairnessFlagThreshold) continue;
        if (best === null || gap > best.gap) best = { give, get, gap };
      }
    }
  }
  if (best === null) {
    throw new Error("[e2e] writeTradesFixture: no combination of manager A and B's starters crosses the fairness threshold — the dealt rosters are too even.");
  }

  const fixture: TradesFixture = { giveNames: best.give.map((p) => p.name), getNames: best.get.map((p) => p.name) };
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(E2E_TRADES_FIXTURE_STATE, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  console.log(`[e2e] trades fixture: give [${fixture.giveNames.join(", ")}] for [${fixture.getNames.join(", ")}], gap ${best.gap.toFixed(1)}`);
}

// ---------------------------------------------------------------------------------------------
// `e2e/enforcement.spec.ts`'s own two leagues (Phase 3 Plan D, Task 10) — the same per-spec-
// seeding idiom `ensureTradesLeague` above already established, never bolted onto that spec's own
// league: journey 3 needs a trade that crosses `INTEGRITY_CONFIG.trade.autoHoldThreshold` (35),
// well past `E2E_TRADES_LEAGUE_ID`'s own `fairnessFlagThreshold`-only fixture, and journey 2 needs
// a league nobody has drafted yet so a real commissioner can reschedule and start it live.
// ---------------------------------------------------------------------------------------------

export const E2E_HELD_TRADE_LEAGUE_ID = "e2e_held_trade_league";
const E2E_HELD_TRADE_DRAFT_ID = "e2e_held_trade_draft";
export const E2E_HELD_TRADE_TEAM_A_ID = "e2e_held_trade_team_a";
export const E2E_HELD_TRADE_TEAM_B_ID = "e2e_held_trade_team_b";
/** Same reasoning as `E2E_TRADES_WEEK_NUMBER`'s own docblock, verbatim: past `regularSeasonWeeks`
 *  so `tickUntilLiveWeekReached`'s own repeated ticking can never lock it, and inside the
 *  committed mock dataset's real last week (17) so the advisor's trend window has real numbers
 *  to value players from. A SEPARATE league from `E2E_TRADES_LEAGUE_ID` needs its own matchup row
 *  at this same week for the identical reason that file's does. */
export const E2E_HELD_TRADE_WEEK_NUMBER = LEAGUE_CONFIG.maxWeeks;
export const E2E_HELD_TRADE_FIXTURE_STATE = resolve(AUTH_DIR, "held-trade-fixture.json");

export interface HeldTradeFixture {
  readonly giveNames: readonly string[];
  readonly getNames: readonly string[];
}

/** `STANDARD_ROSTER_SLOTS` minus `BENCH` — the identical bench-empty trick `ensureTradesLeague`
 *  uses, so ANY equal-count starter swap always finds room on both sides without simulating
 *  `plannedTransfer`. Bench-only packages top out well under `autoHoldThreshold` for a league
 *  this size (measured directly against the committed dataset) — reaching the auto-hold gate
 *  needs starters, the same reason `seed-enforcement.ts`'s own held-trade league deals this way. */
const HELD_TRADE_STARTER_SLOTS = STANDARD_ROSTER_SLOTS.filter((slot) => slot.slot !== "BENCH");

/**
 * Deals both teams full starter rosters (bench empty, idempotent the same way `ensureTradesLeague`
 * is) and writes the widest-gap combination of manager A's and manager B's real starters that
 * crosses `INTEGRITY_CONFIG.trade.autoHoldThreshold` — never a hand-picked pair that could drift
 * the moment the committed dataset or the snake draft's own order changed. The spec itself
 * proposes and accepts this pair live, through the real UI; `acceptTrade`'s own auto-hold branch
 * (Plan D, Task 5) is what turns that acceptance into a `held` trade, never a direct write here.
 */
async function ensureHeldTradeLeague(db: Db, managerAUserId: string, managerBUserId: string): Promise<void> {
  const teamIds: readonly string[] = [E2E_HELD_TRADE_TEAM_A_ID, E2E_HELD_TRADE_TEAM_B_ID];
  const owners: readonly string[] = [managerAUserId, managerBUserId];

  await db
    .insert(leagues)
    .values({
      id: E2E_HELD_TRADE_LEAGUE_ID,
      name: "E2E Held Trade League",
      format: "snake",
      teamCount: teamIds.length,
      isPublicMatchmade: true,
      commissionerUserId: managerAUserId,
      rosterSlots: [...STANDARD_ROSTER_SLOTS],
    })
    .onConflictDoUpdate({ target: leagues.id, set: { isPublicMatchmade: true, commissionerUserId: managerAUserId } });

  await db.insert(scoringSettings).values({ leagueId: E2E_HELD_TRADE_LEAGUE_ID, ...PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(teamIds.map((id, i) => ({ id, leagueId: E2E_HELD_TRADE_LEAGUE_ID, userId: owners[i], name: `E2E Held Trade Team ${i + 1}` })))
    .onConflictDoUpdate({ target: teams.id, set: { userId: sql`excluded.user_id` } });

  await db
    .insert(drafts)
    .values({ id: E2E_HELD_TRADE_DRAFT_ID, leagueId: E2E_HELD_TRADE_LEAGUE_ID, format: "snake", status: "complete", kickoffAt: new Date(), auctionBudget: null })
    .onConflictDoNothing({ target: drafts.id });

  await db
    .insert(matchups)
    .values({ leagueId: E2E_HELD_TRADE_LEAGUE_ID, weekNumber: E2E_HELD_TRADE_WEEK_NUMBER, homeTeamId: E2E_HELD_TRADE_TEAM_A_ID, awayTeamId: E2E_HELD_TRADE_TEAM_B_ID })
    .onConflictDoNothing();

  const [existingRoster] = await db.select({ teamId: rosterSlots.teamId }).from(rosterSlots).where(eq(rosterSlots.teamId, E2E_HELD_TRADE_TEAM_A_ID)).limit(1);
  if (existingRoster === undefined) {
    const pool = await rankedPlayers(db, E2E_HELD_TRADE_LEAGUE_ID);
    const taken = new Set<string>();
    const rosters = new Map(teamIds.map((id) => [id, [] as { slot: RosterSlotType; slotIndex: number; playerId: string }[]]));
    const totalPicks = teamIds.length * totalRosterSlots(HELD_TRADE_STARTER_SLOTS);

    for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber++) {
      const teamId = snakeTeamForPick(teamIds, pickNumber);
      const roster = rosters.get(teamId)!;
      const sizeBefore = roster.length;
      for (const player of pool) {
        if (taken.has(player.id)) continue;
        const assignment = assignSlot({ position: player.position, roster, slotConfig: HELD_TRADE_STARTER_SLOTS });
        if (!assignment.ok) continue;
        taken.add(player.id);
        roster.push({ slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: player.id });
        break;
      }
      if (roster.length === sizeBefore) {
        throw new Error(`[e2e] ensureHeldTradeLeague: no eligible player left in the pool for pick ${pickNumber} (team ${teamId}).`);
      }
    }

    const slotRows = [...rosters.entries()].flatMap(([teamId, slots]) => slots.map((slot) => ({ teamId, ...slot })));
    await db.insert(rosterSlots).values(slotRows);
  }

  const [contextA, contextB] = await Promise.all([
    assembleAdvisorContext(db, { leagueId: E2E_HELD_TRADE_LEAGUE_ID, teamId: E2E_HELD_TRADE_TEAM_A_ID, weekNumber: E2E_HELD_TRADE_WEEK_NUMBER }),
    assembleAdvisorContext(db, { leagueId: E2E_HELD_TRADE_LEAGUE_ID, teamId: E2E_HELD_TRADE_TEAM_B_ID, weekNumber: E2E_HELD_TRADE_WEEK_NUMBER }),
  ]);
  if (contextA === null || contextB === null) {
    throw new Error("[e2e] ensureHeldTradeLeague: manager A or B's team doesn't resolve in the held-trade league yet.");
  }
  const teamAPlayers = contextA.me.players;
  const teamBPlayers = contextB.me.players;

  function combinationsOfSize<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
    if (size === 0) return [[]];
    if (size > items.length) return [];
    const [head, ...rest] = items;
    return [...combinationsOfSize(rest, size - 1).map((combo) => [head!, ...combo]), ...combinationsOfSize(rest, size)];
  }

  const autoHoldThreshold = INTEGRITY_CONFIG.trade.autoHoldThreshold;
  if (autoHoldThreshold === null) {
    throw new Error("[e2e] ensureHeldTradeLeague: INTEGRITY_CONFIG.trade.autoHoldThreshold is null — the auto-hold gate is switched off, so no trade this league proposes could ever hold.");
  }

  let best: { readonly give: readonly string[]; readonly get: readonly string[]; readonly gap: number } | null = null;
  const maxSize = Math.min(TRADE_CONFIG.maxAssetsPerSide, teamAPlayers.length, teamBPlayers.length);
  for (let size = 1; size <= maxSize; size++) {
    for (const give of combinationsOfSize(teamAPlayers, size)) {
      const giveSum = give.reduce((total, player) => total + player.averagePoints, 0);
      for (const get of combinationsOfSize(teamBPlayers, size)) {
        const getSum = get.reduce((total, player) => total + player.averagePoints, 0);
        const gap = Math.abs(giveSum - getSum);
        if (gap < autoHoldThreshold) continue;
        if (best === null || gap > best.gap) best = { give: give.map((p) => p.name), get: get.map((p) => p.name), gap };
      }
    }
  }
  if (best === null) {
    throw new Error("[e2e] ensureHeldTradeLeague: no combination of manager A and B's starters crosses the auto-hold threshold — the dealt rosters are too even.");
  }

  const fixture: HeldTradeFixture = { giveNames: best.give, getNames: best.get };
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(E2E_HELD_TRADE_FIXTURE_STATE, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  console.log(`[e2e] held-trade fixture: give [${fixture.giveNames.join(", ")}] for [${fixture.getNames.join(", ")}], gap ${best.gap.toFixed(1)}`);
}

export const E2E_DRAFT_SCHEDULE_LEAGUE_ID = "e2e_draft_schedule_league";
const E2E_DRAFT_SCHEDULE_DRAFT_ID = "e2e_draft_schedule_draft";
export const E2E_DRAFT_SCHEDULE_TEAM_A_ID = "e2e_draft_schedule_team_a";
export const E2E_DRAFT_SCHEDULE_TEAM_B_ID = "e2e_draft_schedule_team_b";
export const E2E_DRAFT_SCHEDULE_INVITE_STATE = resolve(AUTH_DIR, "draft-schedule-invite.json");

export interface DraftScheduleInvite {
  readonly code: string;
}

/** Unpredictable, the same "not `Math.random`" discipline `POST /api/leagues/[leagueId]/invites`
 *  itself keeps (that route's own `cryptoRandom`, not exported — this is scaffolding calling the
 *  real `createInvite` service directly, never the HTTP route, so it needs its own copy). */
function cryptoRandom(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! / 2 ** 32;
}

/**
 * A league nobody has drafted yet, two real managers already seated (so `store.startDraft`'s own
 * `draftOrder.length >= 2` precondition is met the moment the commissioner presses the button —
 * journey 2 never drives a live "accept invite" through the browser; the invite it mints below is
 * read-only scaffolding for the SIGNED-OUT preview read), and a real, reusable invite code.
 * Deliberately `isPublicMatchmade: false`: journey 2 needs the commissioner's OWN press
 * (`POST /api/drafts/[draftId]/start`, "the first time any browser in this product's history has
 * called that route") to be what starts it, and a public league whose kickoff this file set
 * anywhere in the past would race that press against Task 7's own auto-start ticker running
 * inside the dev server this suite drives.
 */
async function ensureDraftScheduleLeague(db: Db, managerAUserId: string, managerBUserId: string): Promise<void> {
  const teamIds: readonly string[] = [E2E_DRAFT_SCHEDULE_TEAM_A_ID, E2E_DRAFT_SCHEDULE_TEAM_B_ID];
  const owners: readonly string[] = [managerAUserId, managerBUserId];

  await db
    .insert(leagues)
    .values({
      id: E2E_DRAFT_SCHEDULE_LEAGUE_ID,
      name: "E2E Draft Schedule League",
      format: "snake",
      teamCount: teamIds.length,
      isPublicMatchmade: false,
      commissionerUserId: managerAUserId,
      rosterSlots: [...STANDARD_ROSTER_SLOTS],
    })
    .onConflictDoUpdate({ target: leagues.id, set: { commissionerUserId: managerAUserId } });

  await db.insert(scoringSettings).values({ leagueId: E2E_DRAFT_SCHEDULE_LEAGUE_ID, ...PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(teamIds.map((id, i) => ({ id, leagueId: E2E_DRAFT_SCHEDULE_LEAGUE_ID, userId: owners[i], name: `E2E Draft Schedule Team ${i + 1}` })))
    .onConflictDoUpdate({ target: teams.id, set: { userId: sql`excluded.user_id` } });

  // A re-run must never re-schedule a draft the previous run already started — a bare re-insert
  // with `onConflictDoUpdate` on `kickoffAt` alone leaves `status` untouched either way, the same
  // "never touch status on a re-run" discipline `seedPublicLeagues`/`seed-enforcement.ts`'s own
  // auto-start league keep.
  const kickoffAt = new Date(Date.now() + 2 * 60 * 60 * 1000);
  await db
    .insert(drafts)
    .values({ id: E2E_DRAFT_SCHEDULE_DRAFT_ID, leagueId: E2E_DRAFT_SCHEDULE_LEAGUE_ID, format: "snake", status: "scheduled", kickoffAt, auctionBudget: null })
    .onConflictDoUpdate({ target: drafts.id, set: { kickoffAt } });

  const [existingInvite] = await db.select({ code: leagueInvites.code }).from(leagueInvites).where(eq(leagueInvites.leagueId, E2E_DRAFT_SCHEDULE_LEAGUE_ID)).limit(1);
  const code =
    existingInvite?.code ??
    (await (async () => {
      const result = await createInvite(
        { db, clock: { now: () => new Date().toISOString() }, random: cryptoRandom },
        { leagueId: E2E_DRAFT_SCHEDULE_LEAGUE_ID, createdByUserId: managerAUserId },
      );
      if (!result.ok) throw new Error(`[e2e] ensureDraftScheduleLeague: couldn't mint an invite: ${result.reason}`);
      return result.code;
    })());

  const invite: DraftScheduleInvite = { code };
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(E2E_DRAFT_SCHEDULE_INVITE_STATE, JSON.stringify(invite, null, 2), { mode: 0o600 });
  console.log(`[e2e] draft-schedule league ready, invite code ${code}`);
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

  const [a, b, c, zero, signOut] = await Promise.all([
    mintLabSession({ email: MANAGER_A_EMAIL, password: MANAGER_PASSWORD }),
    mintLabSession({ email: MANAGER_B_EMAIL, password: MANAGER_PASSWORD }),
    mintLabSession({ email: MANAGER_C_EMAIL, password: MANAGER_PASSWORD }),
    mintLabSession({ email: MANAGER_ZERO_EMAIL, password: MANAGER_PASSWORD }),
    mintLabSession({ email: MANAGER_SIGNOUT_EMAIL, password: MANAGER_PASSWORD }),
  ]);

  mkdirSync(AUTH_DIR, { recursive: true });
  // Bearer credentials on disk: same 0600 treatment the mint script gives its own output.
  writeFileSync(MANAGER_A_STATE, storageState(baseURL, a.cookie), { mode: 0o600 });
  writeFileSync(MANAGER_B_STATE, storageState(baseURL, b.cookie), { mode: 0o600 });
  writeFileSync(MANAGER_C_STATE, storageState(baseURL, c.cookie), { mode: 0o600 });
  writeFileSync(MANAGER_ZERO_STATE, storageState(baseURL, zero.cookie), { mode: 0o600 });
  writeFileSync(MANAGER_SIGNOUT_STATE, storageState(baseURL, signOut.cookie), { mode: 0o600 });

  const browser = await chromium.launch();
  try {
    for (const state of [MANAGER_A_STATE, MANAGER_B_STATE, MANAGER_C_STATE, MANAGER_ZERO_STATE, MANAGER_SIGNOUT_STATE]) {
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
    // Phase 3 Plan C, Task 9: `e2e/trades.spec.ts`'s own league, real WorkOS ids only known
    // here, at Playwright's own runtime — see `ensureTradesLeague`'s own docblock.
    await ensureTradesLeague(operatorDb, a.userId, b.userId, c.userId);
    // Phase 3 Plan D, Task 10: `e2e/enforcement.spec.ts`'s own two leagues — see each function's
    // own docblock for why neither reuses `ensureTradesLeague`'s.
    await ensureHeldTradeLeague(operatorDb, a.userId, b.userId);
    await ensureDraftScheduleLeague(operatorDb, a.userId, b.userId);
  } finally {
    await operatorDb.$client.end();
  }

  await resetIngestionRedisState();
  await tickUntilLiveWeekReached();
}
