import { fileURLToPath } from "node:url";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { getDb } from "@/db/client";
import { drafts, leagues, teams, users } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { AuditLogger } from "@/integrity-service/audit-logger";
import { getStatsProvider } from "@/stats-pipeline";
import { getIngestionBudget } from "@/stats-pipeline";
import { envOrUndefined } from "@/lib/env";
import { ENFORCEMENT_REFUSALS } from "@/league-service/enforcement";
import { ensureHouseCatalog } from "@/league-service/house-factory";
import { joinPublicLeague } from "@/league-service/join";
import type { HouseRungName } from "@/matchmaking/house-catalog";
import { DEV_SEED } from "./config";
import { ensureMockBotRoster } from "./bot-roster";
import { assertLocalSeedTarget } from "./guard";
import { isSafeToKeepFillingHouseLeague, staleHouseShelfMessage } from "./house-fill-safety";
import { seedDevLeagues } from "./seed-dev-leagues";
import { seedEnforcement } from "./seed-enforcement";
import { seedFormatDemos } from "./seed-format-demos";
import { seedMultiAccountSuspect } from "./seed-integrity";
import { seedOperator } from "./seed-operator";
import { seedPlayers } from "./seed-players";
import { seedPublicLeagues } from "./seed-public-leagues";
import { MEDIAN_DEMO_LEAGUE, seedSeasonLeague, VETERAN_SEASON_LEAGUES } from "./seed-season-league";
import { seedTrades } from "./seed-trades";

/**
 * Phase 3.5 addendum, Task 15, Step 1: "the factory is a reconciler, so seeding it is running
 * it." No house fixture module — `seedPublicLeagues`/`seedDevLeagues` write their `leagues` row
 * by direct Drizzle upsert so THEIR OWN re-run stays safe, which is also why neither one produces
 * a `league_created` audit event. This arc never upserts a `leagues` row at all: it calls the
 * real `ensureHouseCatalog` (`@/league-service/house-factory`), fills the shelf's own earliest
 * SAFE `open_12` league (fix round 1, F1 — see `resolveSafeFillTarget` below) through the real
 * `joinPublicLeague`, then calls `ensureHouseCatalog` again —
 * re-runnable because `ensureHouseCatalog` is idempotent BY CONSTRUCTION (ruling 35), never
 * because this function upserts anything.
 *
 * `open_12`, never `beginner_12`: `tierJoinPrecondition` (`@/league-service/enforcement`) only
 * ever blocks a `beginner`-tier league, and only against a VETERAN joiner — `open_12`'s
 * `experienceTier` is `"experienced"`, so it blocks nobody, and this arc's own dedicated
 * identities (below) never have to prove they aren't veterans to reach it. `beginner_12` would
 * additionally need the SAME dedicated-identity discipline `seedTierDemoIdentities`
 * (`./seed-tier-demo.ts`) already keeps for its own aging-class incident — a needless second copy
 * of that hazard for an arc that doesn't need to touch the tier gate at all.
 *
 * `open_12`, never `sitandgo_12` — RETARGETED (founder directive 2026-08-26): `sitandgo_12` is
 * retired to `openAtOnce: 0`, so `ensureHouseCatalog` never spawns one for this arc to fill at
 * all any more; the choice is no longer between two rungs, only one still exists to pick. What
 * used to distinguish them (a `'scheduled'`-trigger fill leaves `kickoff_at` untouched, a
 * `'when_full'` fill moves it to `now + graceSeconds` via `fireWhenFullInTx`, `./fill-trigger.ts`)
 * no longer distinguishes anything either: `open_12` is `'when_full'` now too, exactly like
 * `sitandgo_12` always was, so filling it moves its kickoff the identical way. The demo league
 * this arc fills is therefore no longer "stable forever, full but never drafting" — it starts
 * drafting a few minutes after `npm run seed` finishes, which is an accurate demonstration of the
 * sit-and-go feature this whole shelf now runs on, not a stale artifact of the old
 * scheduled/when_full split. The ticker CAN advance this league's kickoff out from under a later
 * `npm run dev` the same "a seeded league the ticker can move" way `seed-tier-demo.ts`'s own
 * docblock already root-caused once — accepted here rather than routed around, because there is
 * no other rung left for this arc to fill instead.
 *
 * The EARLIEST SAFE `open_12` league, addressed by creation order rather than a hardcoded id
 * (this arc has no reason to know `house-factory.ts`'s own `house_${rung}_${edition}` format):
 * `resolveSafeFillTarget` (below) walks every `open_12` league oldest-first and stops at the
 * first one that is either already fully seated (nothing left to join — see fix round 1, F1) or
 * has a comfortably-future kickoff. A re-run's own `ensureHouseCatalog` call never re-opens a
 * league that already exists, so on an ordinary re-run (run twice in quick succession, the
 * standard this arc is verified against) the earliest league is STILL the same fully-seated row
 * it was after the first run — safe unconditionally, so it is selected again immediately and
 * `neededSeats` reads back `0`. `fillerIds` is then empty and the join loop below never executes
 * at all on a re-run — no `joinPublicLeague` call is made, `alreadyMember` or otherwise.
 */
export interface SeedHouseCatalogDemoResult {
  readonly rung: HouseRungName;
  readonly filledLeagueId: string;
  /** New seats taken THIS call — `0` on a re-run, whose shortfall reads back `0` and skips the
   *  join loop entirely. */
  readonly seatsJoined: number;
  /** Every league id `ensureHouseCatalog`'s SECOND call actually opened — empty on a re-run that
   *  found the shelf already at `openAtOnce` width. */
  readonly replacementOpened: readonly string[];
}

const HOUSE_DEMO_RUNG: HouseRungName = "open_12";
const HOUSE_DEMO_FILLER_ID_PREFIX = "dev_house_demo_";

interface HouseFillTarget {
  readonly id: string;
  readonly teamCount: number;
  readonly existingSeats: number;
}

/**
 * Fix round 1, F1: walks every `open_12` league oldest-first (never just the single earliest one
 * this arc used to assume) and returns the FIRST one safe to touch — already fully seated
 * (nothing left to join, so no `autoStartDueDrafts` race is possible regardless of its kickoff),
 * or short of capacity with a kickoff still comfortably in the future
 * (`isSafeToKeepFillingHouseLeague`, `./house-fill-safety.ts`). A league that is BOTH short of
 * capacity AND too close to (or past) its own kickoff is skipped — seating a second member into
 * it risks the real ticker's `autoStartDueDrafts` claiming its draft mid-loop, an intermittent
 * `DRAFT_ALREADY_STARTED` refusal unrelated to this arc's own reconciler proof (found running
 * this against a long-lived shared dev database, where an early `open_12` edition's fixed kickoff
 * had aged well past "now"). Throws, loudly and by name, only if EVERY candidate is unsafe — never
 * silently proceeds against a stale one, and never hand-stamps a house league's kickoff, which has
 * no legitimate write path at all (`./house-fill-safety.ts`'s own docblock).
 */
async function resolveSafeFillTarget(db: Db, clock: Clock, rung: HouseRungName): Promise<HouseFillTarget> {
  const candidates = await db
    .select({ id: leagues.id, teamCount: leagues.teamCount, kickoffAt: drafts.kickoffAt })
    .from(leagues)
    .innerJoin(drafts, eq(drafts.leagueId, leagues.id))
    .where(eq(leagues.houseRung, rung))
    .orderBy(asc(leagues.createdAt));
  if (candidates.length === 0) {
    throw new Error(`seedHouseCatalogDemo: ensureHouseCatalog didn't open any ${rung} league to fill.`);
  }

  for (const candidate of candidates) {
    const existingSeats = await db.select({ id: teams.id }).from(teams).where(eq(teams.leagueId, candidate.id));
    const alreadyFull = existingSeats.length >= candidate.teamCount;
    if (alreadyFull || isSafeToKeepFillingHouseLeague(candidate.kickoffAt, clock.now())) {
      return { id: candidate.id, teamCount: candidate.teamCount, existingSeats: existingSeats.length };
    }
  }

  throw new Error(staleHouseShelfMessage(rung, "seedHouseCatalogDemo"));
}

export async function seedHouseCatalogDemo(
  db: Db,
  clock: Clock,
  deps: { readonly audit?: AuditLogger; readonly newId?: () => string } = {},
): Promise<SeedHouseCatalogDemoResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedHouseCatalogDemo creates placeholder users and must never run in production.");
  }
  const newId = deps.newId ?? (() => crypto.randomUUID());

  // Stock the shelf first — the reconciler this arc exists to prove, run for real rather than
  // assumed already caught up.
  await ensureHouseCatalog(db, { clock, newId, audit: deps.audit });

  const target = await resolveSafeFillTarget(db, clock, HOUSE_DEMO_RUNG);

  // The SHORTFALL, read back from the league's own seats — never a hard-coded 12. A long-lived
  // shared dev database can have a REAL developer already sitting in this exact league (found
  // running this against one: a real WorkOS id held the last of what this arc assumed were 12
  // empty seats, and the 12th dedicated filler's own join overflowed it by one). Reading the
  // actual count first is what keeps this arc correct whether the league is genuinely empty or
  // already partly claimed by someone real.
  const neededSeats = Math.max(0, target.teamCount - target.existingSeats);
  const fillerIds = Array.from({ length: neededSeats }, (_, i) => `${HOUSE_DEMO_FILLER_ID_PREFIX}${String(i + 1).padStart(2, "0")}`);
  if (fillerIds.length > 0) {
    await db
      .insert(users)
      .values(fillerIds.map((id) => ({ id, email: `${id}@${DEV_SEED.emailDomain}`, displayName: `Dev Manager (${id})` })))
      .onConflictDoNothing({ target: users.id });
  }

  let seatsJoined = 0;
  for (const userId of fillerIds) {
    const outcome = await joinPublicLeague({ db, newId, clock, audit: deps.audit }, { leagueId: target.id, userId });
    if (!outcome.ok) {
      throw new Error(`seedHouseCatalogDemo: join for ${userId} against ${target.id} was refused: ${outcome.reason}`);
    }
    if (!outcome.alreadyMember) seatsJoined += 1;
  }

  // THE proof: the filled league just dropped off the shelf's own open count, and a re-run of the
  // identical reconciler either opens its real replacement (a fresh run) or finds the shelf
  // already restocked and opens nothing (a re-run) — never a hand-stamped row standing in for
  // either outcome.
  const after = await ensureHouseCatalog(db, { clock, newId, audit: deps.audit });

  return { rung: HOUSE_DEMO_RUNG, filledLeagueId: target.id, seatsJoined, replacementOpened: after.opened };
}

/**
 * The ONE seed entry point (`npm run seed`). Later steps add seeders here — a demo league,
 * public leagues at various fill levels — never as separate ad-hoc scripts.
 */
async function main(): Promise<void> {
  // BEFORE getDb(), and before the first upsert: `seedPlayers` mass-upserts every `players`
  // and `player_stat_lines` row, so a guard placed after it would fire far too late.
  assertLocalSeedTarget();
  const db = getDb();
  // Phase 4.5, Task 2: the platform's practice-opponent roster, ensured before anything else
  // runs — NOT guarded by `assertLocalSeedTarget` (that guard already fired above for this
  // script's OWN developer-fixture arcs; `ensureMockBotRoster` itself carries no such guard,
  // because a production database needs this exact call the day its first mock room is
  // created, through `createMockRoom`'s own identical call, Task 5). Idempotent, so running it
  // here changes nothing about a database `createMockRoom` already seeded on its own.
  await ensureMockBotRoster(db);
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
  // `MEDIAN_DEMO_LEAGUE` (Phase 3.5, Task 10): the SAME claimUserId-threaded loop, one more
  // entry — a median-game league settled the identical way, so manager A's own identity (a real
  // developer's claimed account, or `e2e/global-setup.ts`'s own manager A) lands on a league
  // with a real second (median) result in its standings, not a stamped one.
  for (const leagueConfig of [DEV_SEED.season, ...VETERAN_SEASON_LEAGUES, MEDIAN_DEMO_LEAGUE]) {
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

  // Phase 3.5, Task 10, Step 1: the four remaining arcs — superflex through the real draft
  // engine, the slow-draft skip-and-owe and its own redemption, an order really drawn from real
  // preference rows, and a sit-and-go league that really fills through the real
  // `joinPublicLeague` transaction. See `seed-format-demos.ts`'s own docblock.
  const formats = await seedFormatDemos(db, { now: () => new Date().toISOString() });
  console.log(
    `format demos: superflex second-QB slotted ${formats.superflex.secondQuarterbackSlotted} (${formats.superflex.leagueId}), ` +
      `skip-and-owe redeemed ${formats.skipAndOwe.redeemed} for ${formats.skipAndOwe.skippedTeamId} (${formats.skipAndOwe.leagueId}), ` +
      `slot preference matched the real draw ${formats.slotPreference.matchedRealDraw} (${formats.slotPreference.leagueId}), ` +
      `sit-and-go kickoff rewritten ${formats.sitAndGo.kickoffRewritten} (${formats.sitAndGo.leagueId})`,
  );

  // Phase 3.5 addendum, Task 15, Step 1: last, on purpose — every arc above this one seats or
  // moves an identity this arc doesn't touch, so placing the house arc last leaves the shelf's
  // own end state (one filled `open_12` league, its replacement standing behind it) the same
  // regardless of what ran before it, which is what makes it a deterministic base for `npm run
  // dev` and for the e2e walk (`e2e/formats-and-lobby.spec.ts`) alike.
  const house = await seedHouseCatalogDemo(db, { now: () => new Date().toISOString() });
  console.log(
    `house catalog: filled ${house.filledLeagueId} (${house.seatsJoined} new seat(s)), ` +
      `replacement(s) opened: ${house.replacementOpened.length === 0 ? "none" : house.replacementOpened.join(", ")}`,
  );
  // The whole shelf is sit-and-go now (founder directive 2026-08-26): a FULL league's draft
  // fires on the when_full grace, so the demo league above genuinely starts drafting shortly
  // after seeding — a feature demo, not a stale artifact (T1 review note). Said out loud so a
  // developer who loads the app later isn't surprised to find the room mid-draft.
  console.log("note: the filled demo league is sit-and-go and will start drafting within minutes of seeding");
}

// Guarded so `index.test.ts` (Task 15, Step 1) can import `seedHouseCatalogDemo` without running
// the whole script — `main()` reaches a real database and a real stats provider, neither of which
// a unit test should touch by the mere act of importing this module. Every other export above is
// a plain function; this is the one top-level side effect the file has, and it fires only when
// `tsx src/data/seed/index.ts` (`npm run seed`) is the process's own entry point.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(() => process.exit(0)).catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
