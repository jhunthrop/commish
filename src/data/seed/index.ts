import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { teams } from "@/db/schema";
import { getStatsProvider } from "@/stats-pipeline";
import { getIngestionBudget } from "@/stats-pipeline";
import { envOrUndefined } from "@/lib/env";
import { ENFORCEMENT_REFUSALS } from "@/league-service/enforcement";
import { joinPublicLeague } from "@/league-service/join";
import { DEV_SEED } from "./config";
import { assertLocalSeedTarget } from "./guard";
import { seedDevLeagues } from "./seed-dev-leagues";
import { seedEnforcement } from "./seed-enforcement";
import { seedMultiAccountSuspect } from "./seed-integrity";
import { seedOperator } from "./seed-operator";
import { seedPlayers } from "./seed-players";
import { seedPublicLeagues } from "./seed-public-leagues";
import { seedSeasonLeague, VETERAN_SEASON_LEAGUES } from "./seed-season-league";
import { seedTrades } from "./seed-trades";

/**
 * The ONE seed entry point (`npm run seed`). Later steps add seeders here — a demo league,
 * public leagues at various fill levels — never as separate ad-hoc scripts.
 */
async function main(): Promise<void> {
  // BEFORE getDb(), and before the first upsert: `seedPlayers` mass-upserts every `players`
  // and `player_stat_lines` row, so a guard placed after it would fire far too late.
  assertLocalSeedTarget();
  const db = getDb();
  // The real ledger, not the unmetered default: this is the one caller whose provider may be a
  // live feed with a real key behind it, so this is where the backfill's spending has to be
  // counted. Everything else that calls `seedPlayers` drives the mock and costs nothing upstream.
  const playerCounts = await seedPlayers(db, getStatsProvider(), undefined, getIngestionBudget());
  console.log(`seeded ${playerCounts.players} players and ${playerCounts.statLines} stat lines`);
  // The only place that reads DEV_SEED_CLAIM_USER_ID — seedDevLeagues takes it as an explicit
  // parameter rather than reaching into process.env itself. See seed-dev-leagues.ts.
  // `envOrUndefined`, not a bare `process.env[...]` read: `.env.example` ships
  // `DEV_SEED_CLAIM_USER_ID=` (an intentionally empty line), so an un-set-up `.env.local` reads
  // as `""`, not `undefined` — and `ensureDevUsers` branches on `claimUserId !== undefined`, so
  // an unguarded `""` would pass that check and get written as a `teams.user_id`/
  // `leagues.commissioner_user_id` FK to a `users` row that does not exist.
  const claimUserId = envOrUndefined(DEV_SEED.claimUserIdEnvVar);
  const dev = await seedDevLeagues(db, { now: () => new Date().toISOString() }, claimUserId);
  console.log(`seeded ${dev.leagues} dev leagues, ${dev.teams} teams and ${dev.drafts} scheduled drafts`);

  // AFTER seedDevLeagues, not before: `ensureDevUsers` (called inside it) is what creates the
  // fallback `dev_user_01` row this grants when no `claimUserId` is set, and `grantAdmin`'s own
  // UPDATE only ever matches an EXISTING user.
  const operator = await seedOperator(db, { now: () => new Date().toISOString() }, claimUserId);
  console.log(operator.ok ? `granted operator access to ${operator.userId}` : `operator grant skipped: ${operator.reason}`);

  // Phase 3 Plan D, Task 10, Step 1: THREE real playthroughs, not one league counted three
  // times — `DEV_SEED.season` plus the two `VETERAN_SEASON_LEAGUES`, every one of them settled
  // week by week through the real `finalizeWeekInTx` (ruling 24). Team 1's owner is the SAME
  // identity across all three (`claimUserId`, or `dev_user_01` when unset), so by the time this
  // loop finishes that identity has genuinely crossed `INTEGRITY_CONFIG.participation.
  // veteranSeasonCutoff` (3) — a real veteran, not a stamped one.
  for (const leagueConfig of [DEV_SEED.season, ...VETERAN_SEASON_LEAGUES]) {
    const season = await seedSeasonLeague(db, { now: () => new Date().toISOString() }, claimUserId, leagueConfig);
    console.log(`seeded a ${season.teams}-team season league (${leagueConfig.leagueId}) with ${season.weeks} weeks (${season.scoredWeeks} scored)`);
  }
  const open = await seedPublicLeagues(db, { now: () => new Date().toISOString() });
  console.log(`seeded ${open.leagues} public matchmaking leagues with ${open.teams} joined managers`);

  // Phase 3 Plan D, Task 10, Step 1's second half: the SAME veteran identity, pointed at a
  // seeded `beginner` public league it holds no seat in (`seedPublicLeagues` never spends
  // index 0's own seat — see that file's own docblock) — through the real `joinPublicLeague`
  // route, never a synthesized refusal. `npm run seed && npm run dev` therefore puts a real
  // `tier_blocked_join` notice in that account's own inbox, raised by the real precondition.
  //
  // READ BACK, never re-derived through `ensureDevUsers(db, claimUserId)`: on a long-lived dev
  // database, a PAST run's `preserveRealTeamOwner` may already have handed team 1's own chair to
  // a real claim id under a run THAT had `DEV_SEED_CLAIM_USER_ID` set — `ensureDevUsers` has no
  // memory of that; it only ever answers `claimUserId` (this run's own, possibly `undefined`) or
  // the literal placeholder. Re-deriving here found the real bug running this against the shared
  // dev database: the join "succeeded" because the identity this line guessed was a newcomer who
  // had never actually played a season, while the REAL veteran (still sitting in team 1) was
  // never asked at all. The team row itself is the only honest source for who that is.
  const [team1] = await db.select({ userId: teams.userId }).from(teams).where(eq(teams.id, `${DEV_SEED.season.leagueId}_team_01`));
  const veteranUserId = team1!.userId;
  const tierBlockTarget = DEV_SEED.publicLeagues.find((plan) => plan.leagueId === "dev_public_tier_demo")!.leagueId;
  const blockedJoin = await joinPublicLeague(
    { db, newId: () => crypto.randomUUID(), clock: { now: () => new Date().toISOString() } },
    { leagueId: tierBlockTarget, userId: veteranUserId },
  );
  console.log(
    !blockedJoin.ok && blockedJoin.reason === ENFORCEMENT_REFUSALS.join
      ? `tier segregation: ${veteranUserId} correctly blocked from ${tierBlockTarget}`
      : `tier segregation: unexpected outcome for ${veteranUserId} against ${tierBlockTarget} — ${JSON.stringify(blockedJoin)}`,
  );

  // The real detector, against real rows — the spec's "seed several flags for manual
  // verification" honored without a decorative row (ruling 29). `npm run seed && npm run dev`
  // puts an actual PENDING_REVIEW flag in the operator queue.
  const integrity = await seedMultiAccountSuspect(db, { now: () => new Date().toISOString() }, claimUserId);
  console.log(`multi-account sweep: compared ${integrity.pairsCompared} pair(s), raised ${integrity.flagsRaised} flag(s)`);

  // Ruling 29's own gap, closed (Phase 3 Plan C, Task 9): three real trades through the real
  // `proposeTrade`/`acceptTrade` routes, so the operator queue also carries a real `trade_
  // fairness` flag raised by the real detector — never a decorative row.
  const trades = await seedTrades(db, { now: () => new Date().toISOString() }, claimUserId);
  console.log(`seeded ${trades.tradesAccepted} trade(s) in ${trades.leagueId}, raised ${trades.flagsRaised} fairness flag(s)`);

  // Phase 3 Plan D, Task 10, Step 2: the other three arcs, through the real `proposeTrade`/
  // `acceptTrade` hold branch, the real `autoSetLineupsForWeek`, and the real ticker action
  // (`autoStartDueDrafts`) rather than a direct `startDraft` call — see `seed-enforcement.ts`.
  const enforcement = await seedEnforcement(db, { now: () => new Date().toISOString() });
  console.log(
    `enforcement: trade ${enforcement.heldTrade.outcome} (${enforcement.heldTrade.leagueId}), ` +
      `${enforcement.lineupAutoSet.teamsSet} lineup(s) auto-set in ${enforcement.lineupAutoSet.leagueId}, ` +
      `draft auto-start ${enforcement.draftAutoStart.started ? "started" : "not started"} (${enforcement.draftAutoStart.draftId})`,
  );
}

main().then(() => process.exit(0)).catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
