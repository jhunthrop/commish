import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues, scoringSettings, teams } from "@/db/schema";
import { HALF_PPR_SCORING } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { bestAvailableFor, teamOnClock, type DraftState } from "@/draft-engine";
import { DRAFT_ACTION_VERSION, type DraftAction } from "@/domain/draft";
import { getDraftStore } from "@/draft-service";
import { draftOrderFor } from "@/draft-service/order";
import type { DraftStore } from "@/draft-service/store";
import { setSlotPreference } from "@/draft-service/slot-preference";
import type { AuditLogger } from "@/integrity-service/audit-logger";
import { SUPERFLEX_ROSTER_SLOTS } from "@/league/roster-shape";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import type { ExperienceTier } from "@/domain/user";
import { joinPublicLeague } from "@/league-service/join";
import { ensureDevUsers, preserveRealCommissioner, preserveRealTeamOwner } from "./dev-users";

/**
 * Phase 3.5, Task 10, Step 1: three arcs (superflex, the slow-draft skip-and-owe, and the
 * preference-drawn order) that must run "through the real engine" — the exact `DraftStore`
 * `getDraftStore()` hands the real API routes, never a hand-dealt roster — plus the sit-and-go
 * fill arc, which must run through the real `joinPublicLeague` transaction. The fifth arc (the
 * median league) lives in `seed-season-league.ts`, threaded onto the same `finalizeWeek` loop
 * `DEV_SEED.season`/`VETERAN_SEASON_LEAGUES` already run — see that file's own `MEDIAN_DEMO_LEAGUE`.
 *
 * Every league here is small (2-3 teams) and immediately full, on purpose: these are backstage
 * proofs that a mechanism fires for real, never additional demo rooms a developer is meant to
 * browse or join (the same "stays full, never on /browse" discipline `seed-enforcement.ts`
 * keeps for its own three fixtures) — the first three are `isPublicMatchmade: false` outright
 * (nothing about them is a matchmaking demo), and the sit-and-go arc is `true` but fills itself
 * before this function ever returns, so no human ever finds it half-full.
 *
 * A synthetic virtual clock, never real waiting: every `TIMER_EXPIRE` this file submits carries
 * a constructed timestamp far past any deadline the engine could compute for it (see
 * `TIME_STEP_MS`'s own docblock below) — the identical "admission only checks the timestamp
 * carried on the action, never the wall clock" property `seed-enforcement.ts`'s own auto-start
 * arc already leans on (`admitTimerExpire`, `@/draft-engine/admit.ts`).
 */
export interface SeedFormatDemosDeps {
  readonly audit?: AuditLogger;
  readonly store?: DraftStore;
}

/**
 * Comfortably longer than the widest clock tier (`DRAFT_CLOCK_SCHEDULE`'s own 8-hour ceiling,
 * `@/draft-engine/config.ts`) plus the widest the overnight pause window could ever push a
 * deadline (up to 3 hours) — so every `TIMER_EXPIRE` this file submits is provably past
 * `currentDeadline` no matter which tier or pause state the turn it targets happens to be in.
 * ~27.8 hours.
 */
const TIME_STEP_MS = 100_000_000;

function laterTimestamp(from: string): string {
  return new Date(Date.parse(from) + TIME_STEP_MS).toISOString();
}

/**
 * Advances a real, store-backed draft from whatever state it is already in (scheduled, mid-draft,
 * or already complete) to `phase: "complete"`, using ONLY the real `DraftStore.applyAction` —
 * `MAKE_PICK` when `pickFor` names an explicit player for whichever team is on the clock, and a
 * constructed-future `TIMER_EXPIRE` (a real autopick or a real skip, whichever the engine itself
 * decides) otherwise. Idempotent: called against an already-complete draft, the `while` loop
 * never runs and the log is never touched.
 */
async function driveToCompletion(
  store: DraftStore,
  draftId: string,
  initial: DraftState,
  pickFor: (state: DraftState) => Promise<{ readonly teamId: string; readonly playerId: string } | null>,
): Promise<DraftState> {
  let state = initial;
  while (state.phase !== "complete") {
    const explicit = await pickFor(state);
    const timestamp = laterTimestamp(state.turnStartedAt ?? new Date(0).toISOString());
    const action: DraftAction =
      explicit === null
        ? { v: DRAFT_ACTION_VERSION, type: "TIMER_EXPIRE", timestamp }
        : { v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp, teamId: explicit.teamId, playerId: explicit.playerId };
    const result = await store.applyAction(draftId, action);
    if (!result.ok) {
      throw new Error(`seedFormatDemos: ${action.type} rejected against ${draftId}: ${result.reason}`);
    }
    state = result.state;
  }
  return state;
}

/** Starts `draftId` only while it is still `scheduled` (a re-run must never attempt a second
 *  `START_DRAFT` against a log that already has one), then hands the resulting state back
 *  whatever phase the draft is already in — `driveToCompletion`'s own idempotence covers the rest. */
async function ensureStarted(store: DraftStore, draftId: string): Promise<DraftState> {
  const state = await store.getDraftState(draftId);
  if (state === null) throw new Error(`seedFormatDemos: draft ${draftId} doesn't exist yet.`);
  if (state.phase !== "scheduled") return state;
  const started = await store.startDraft(draftId);
  if (!started.ok) throw new Error(`seedFormatDemos: couldn't start ${draftId}: ${started.reason}`);
  return started.state;
}

/**
 * Fix round 1, F1 (DRY): the league/scoringSettings/teams/drafts insert shape all four arcs
 * below share, extracted once. Every arc still writes its OWN rows (different ids, roster
 * shapes, visibility and team counts) — this only names the shape, never the per-arc content.
 * `experienceTier` defaults to `"beginner"`, the identical value the `leagues.experience_tier`
 * column itself defaults to, so a caller that omits it (every arc but sit-and-go) writes exactly
 * what it always has. `isPublicMatchmade` rides the `onConflictDoUpdate` set too, harmlessly
 * idempotent for the three arcs whose value is always `false`.
 */
interface DemoLeagueShellInput {
  readonly leagueId: string;
  readonly draftId: string;
  readonly name: string;
  readonly teamIds: readonly string[];
  readonly teamOwners: readonly string[];
  readonly teamNamePrefix: string;
  readonly rosterSlots: readonly RosterSlotConfig[];
  readonly isPublicMatchmade: boolean;
  readonly experienceTier?: ExperienceTier;
  readonly kickoffAt: Date;
  readonly startTrigger?: "scheduled" | "when_full";
  /**
   * The league's own full capacity, when it differs from how many of `teamIds` this call seats
   * directly — the sit-and-go arc's own case: one team seated here, one more seat left for a
   * real `joinPublicLeague` call to fill. Defaults to `teamIds.length`, which is every OTHER
   * arc's own shape (every team seated directly, nobody left to join later).
   */
  readonly teamCount?: number;
}

async function insertDemoLeagueShell(db: Db, input: DemoLeagueShellInput): Promise<void> {
  await db
    .insert(leagues)
    .values({
      id: input.leagueId,
      name: input.name,
      format: "snake",
      teamCount: input.teamCount ?? input.teamIds.length,
      isPublicMatchmade: input.isPublicMatchmade,
      experienceTier: input.experienceTier ?? "beginner",
      commissionerUserId: input.teamOwners[0]!,
      rosterSlots: [...input.rosterSlots],
    })
    .onConflictDoUpdate({ target: leagues.id, set: { isPublicMatchmade: input.isPublicMatchmade, commissionerUserId: preserveRealCommissioner() } });

  await db.insert(scoringSettings).values({ leagueId: input.leagueId, ...HALF_PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(input.teamIds.map((id, i) => ({ id, leagueId: input.leagueId, userId: input.teamOwners[i]!, name: `${input.teamNamePrefix} ${i + 1}` })))
    .onConflictDoUpdate({ target: teams.id, set: { userId: preserveRealTeamOwner() } });

  await db
    .insert(drafts)
    .values({
      id: input.draftId,
      leagueId: input.leagueId,
      format: "snake",
      status: "scheduled",
      kickoffAt: input.kickoffAt,
      auctionBudget: null,
      startTrigger: input.startTrigger ?? "scheduled",
    })
    // Never `onConflictDoUpdate`: a re-run that reset `kickoffAt` back to a fresh placeholder
    // would erase whatever a PRIOR run's own real machinery already did to it (the sit-and-go
    // arc's own fill-trigger rewrite is the sharpest example, but every arc's kickoff is a
    // fixture, not something a re-run should ever move).
    .onConflictDoNothing({ target: drafts.id });
}

// -------------------------------------------------------------------------------------------
// Arc A: superflex, through the real engine. A real second quarterback lands in the real
// SUPERFLEX slot because `assignSlot` (`@/draft-engine/slotting`) fills the first eligible slot
// in `SUPERFLEX_ROSTER_SLOTS`' own row order — `QB` before `SUPERFLEX` — so team 1's FIRST two
// quarterbacks (explicitly chosen below, never left to autopick's own ranking-driven luck) fill
// QB then SUPERFLEX in that order, by construction of the config this league itself carries.
// -------------------------------------------------------------------------------------------

const SUPERFLEX_LEAGUE_ID = "dev_superflex_demo";
const SUPERFLEX_DRAFT_ID = "dev_superflex_demo_draft";
const SUPERFLEX_TEAM_1 = `${SUPERFLEX_LEAGUE_ID}_team_1`;
const SUPERFLEX_TEAM_2 = `${SUPERFLEX_LEAGUE_ID}_team_2`;

export interface SuperflexResult {
  readonly leagueId: string;
  readonly secondQuarterbackSlotted: boolean;
}

async function seedSuperflexLeague(db: Db, clock: Clock, store: DraftStore): Promise<SuperflexResult> {
  const owners = await ensureDevUsers(db);
  const teamIds = [SUPERFLEX_TEAM_1, SUPERFLEX_TEAM_2];
  const teamOwners = [owners[1]!, owners[2]!];

  await insertDemoLeagueShell(db, {
    leagueId: SUPERFLEX_LEAGUE_ID,
    draftId: SUPERFLEX_DRAFT_ID,
    name: "Dev Superflex Demo",
    teamIds,
    teamOwners,
    teamNamePrefix: "Superflex Demo",
    rosterSlots: SUPERFLEX_ROSTER_SLOTS,
    isPublicMatchmade: false,
    kickoffAt: new Date(Date.parse(clock.now()) + 48 * 60 * 60 * 1000),
  });

  let qbPicksForTeam1 = 0;
  const initial = await ensureStarted(store, SUPERFLEX_DRAFT_ID);
  const final = await driveToCompletion(store, SUPERFLEX_DRAFT_ID, initial, async (state) => {
    if (teamOnClock(state) !== SUPERFLEX_TEAM_1 || qbPicksForTeam1 >= 2) return null;
    const taken = new Set(state.picks.map((p) => p.playerId));
    const nextQb = state.pool.find((entry) => entry.position === "QB" && !taken.has(entry.playerId));
    if (nextQb === undefined) throw new Error("seedFormatDemos: superflex arc ran out of quarterbacks before team 1 drafted two.");
    qbPicksForTeam1 += 1;
    return { teamId: SUPERFLEX_TEAM_1, playerId: nextQb.playerId };
  });

  const roster = final.rosters[SUPERFLEX_TEAM_1] ?? [];
  const secondQuarterbackSlotted = roster.some((slot) => slot.slot === "SUPERFLEX");
  if (!secondQuarterbackSlotted) {
    throw new Error("seedFormatDemos: superflex arc completed without a second quarterback landing in the SUPERFLEX slot.");
  }

  return { leagueId: SUPERFLEX_LEAGUE_ID, secondQuarterbackSlotted };
}

// -------------------------------------------------------------------------------------------
// Arc C: the slow-draft skip-and-owe, and the redemption. A queueless team's turn really
// expires (a real `TIMER_EXPIRE`, past the deadline `DRAFT_SKIP_POLICY.appliesAtOrAbovePickSeconds`
// requires) and the engine really skips it (`reduceSnakeExpiry`'s own `skipEligible` branch,
// `@/draft-engine/snake.ts`) rather than autopicking, because the kickoff is far enough out
// (200 hours) that the first tier's pick clock is 8 hours — comfortably at or above the policy's
// hour floor. The owed pick is then redeemed out of band, through a real `MAKE_PICK`, before the
// rest of the draft autopicks to completion.
// -------------------------------------------------------------------------------------------

const SKIP_LEAGUE_ID = "dev_skip_owe_demo";
const SKIP_DRAFT_ID = "dev_skip_owe_demo_draft";
const SKIP_TEAM_IDS = [`${SKIP_LEAGUE_ID}_team_1`, `${SKIP_LEAGUE_ID}_team_2`, `${SKIP_LEAGUE_ID}_team_3`] as const;

export interface SkipAndOweResult {
  readonly leagueId: string;
  readonly skippedTeamId: string;
  readonly redeemed: boolean;
}

/**
 * The expiry-and-redeem walk (fix round 1, F2): a real `TIMER_EXPIRE` past the deadline (the
 * skip), asserted to have really skipped rather than autopicked, then a real out-of-band
 * `MAKE_PICK` (the redemption), asserted to have cleared it. Split out of `seedSkipAndOweLeague`
 * purely to bring that function back under the 50-line guideline — identical actions, identical
 * assertions, identical thrown messages.
 */
async function skipThenRedeem(store: DraftStore, draftId: string, started: DraftState): Promise<{ readonly skippedTeamId: string }> {
  // The FIRST team on the clock never queues (Task 5's own consent rule: no queue is what makes
  // a queueless team eligible to be skipped rather than autopicked) — its turn's own real
  // `TIMER_EXPIRE`, past the 8-hour deadline, is what the skip is made of.
  const skippedTeamId = teamOnClock(started)!;
  const expireTimestamp = laterTimestamp(started.turnStartedAt!);
  const expireResult = await store.applyAction(draftId, { v: DRAFT_ACTION_VERSION, type: "TIMER_EXPIRE", timestamp: expireTimestamp });
  if (!expireResult.ok) throw new Error(`seedFormatDemos: skip-and-owe arc's own TIMER_EXPIRE was rejected: ${expireResult.reason}`);

  const owedAfterExpiry = expireResult.state.owedPicks[skippedTeamId] ?? [];
  if (owedAfterExpiry.length !== 1) {
    throw new Error(`seedFormatDemos: skip-and-owe arc expected exactly one owed pick for ${skippedTeamId}, got ${owedAfterExpiry.length}.`);
  }

  // Redeemed out of band — NFFC's forgiveness (Task 5's own docblock, `snake.ts`): a real
  // `MAKE_PICK` submitted for the owing team, not on its own normal turn, through the same
  // `bestAvailableFor` selection an autopick itself would make.
  const redemption = bestAvailableFor(expireResult.state, skippedTeamId);
  if (redemption === null) throw new Error("seedFormatDemos: no eligible player left for the skip-and-owe arc's own redemption.");
  const redeemTimestamp = laterTimestamp(expireResult.state.turnStartedAt ?? expireTimestamp);
  const redeemResult = await store.applyAction(draftId, {
    v: DRAFT_ACTION_VERSION,
    type: "MAKE_PICK",
    timestamp: redeemTimestamp,
    teamId: skippedTeamId,
    playerId: redemption.playerId,
  });
  if (!redeemResult.ok) throw new Error(`seedFormatDemos: skip-and-owe arc's own redemption was rejected: ${redeemResult.reason}`);
  if ((redeemResult.state.owedPicks[skippedTeamId] ?? []).length !== 0) {
    throw new Error("seedFormatDemos: skip-and-owe arc's redemption didn't clear the owed pick.");
  }

  await driveToCompletion(store, draftId, redeemResult.state, async () => null);
  return { skippedTeamId };
}

async function seedSkipAndOweLeague(db: Db, clock: Clock, store: DraftStore): Promise<SkipAndOweResult> {
  const owners = await ensureDevUsers(db);
  const teamOwners = [owners[1]!, owners[2]!, owners[3]!];

  await insertDemoLeagueShell(db, {
    leagueId: SKIP_LEAGUE_ID,
    draftId: SKIP_DRAFT_ID,
    name: "Dev Skip-and-Owe Demo",
    teamIds: [...SKIP_TEAM_IDS],
    teamOwners,
    teamNamePrefix: "Skip Demo",
    rosterSlots: STANDARD_ROSTER_SLOTS,
    isPublicMatchmade: false,
    // 200 hours out: past `DRAFT_CLOCK_SCHEDULE`'s 168-hour threshold, so the draft opens at
    // the 8-hour tier — well at or above `DRAFT_SKIP_POLICY.appliesAtOrAbovePickSeconds` (one hour).
    kickoffAt: new Date(Date.parse(clock.now()) + 200 * 60 * 60 * 1000),
  });

  const started = await ensureStarted(store, SKIP_DRAFT_ID);
  if (started.phase === "complete") {
    // Already fully driven by a prior run — `draftOrder[0]` is always the team pick 1 (and
    // therefore this arc's own skip target) belonged to, whether or not this run replays it.
    return { leagueId: SKIP_LEAGUE_ID, skippedTeamId: started.draftOrder[0]!, redeemed: true };
  }

  const { skippedTeamId } = await skipThenRedeem(store, SKIP_DRAFT_ID, started);
  return { leagueId: SKIP_LEAGUE_ID, skippedTeamId, redeemed: true };
}

// -------------------------------------------------------------------------------------------
// Arc D: the order really drawn from real preference rows. A real `setSlotPreference` write,
// then a real `store.startDraft` — never a hand-assembled `START_DRAFT` action — and the
// resulting `draftOrder` is checked against `draftOrderFor` (`@/draft-service/order`), the exact
// pure function `startDraft` itself calls, run here a second time over the SAME persisted
// preference row to prove the two agree.
// -------------------------------------------------------------------------------------------

const PREF_LEAGUE_ID = "dev_slot_pref_demo";
const PREF_DRAFT_ID = "dev_slot_pref_demo_draft";
const PREF_TEAM_1 = `${PREF_LEAGUE_ID}_team_1`;
const PREF_TEAM_2 = `${PREF_LEAGUE_ID}_team_2`;
/** Team 1's own wish list: slot 2 first, slot 1 second. Which one it actually lands is decided
 *  by the real draw — this arc asserts the outcome against `draftOrderFor`, never assumes it. */
const PREF_RANKING = [2, 1];

export interface SlotPreferenceResult {
  readonly leagueId: string;
  readonly preferringTeamId: string;
  readonly assignedSlot: number;
  readonly matchedRealDraw: boolean;
}

async function seedSlotPreferenceLeague(db: Db, clock: Clock, store: DraftStore): Promise<SlotPreferenceResult> {
  const owners = await ensureDevUsers(db);
  const teamIds = [PREF_TEAM_1, PREF_TEAM_2];
  const teamOwners = [owners[1]!, owners[2]!];

  await insertDemoLeagueShell(db, {
    leagueId: PREF_LEAGUE_ID,
    draftId: PREF_DRAFT_ID,
    name: "Dev Slot Preference Demo",
    teamIds,
    teamOwners,
    teamNamePrefix: "Slot Pref Demo",
    rosterSlots: STANDARD_ROSTER_SLOTS,
    isPublicMatchmade: false,
    kickoffAt: new Date(Date.parse(clock.now()) + 48 * 60 * 60 * 1000),
  });

  const existing = await store.getDraftState(PREF_DRAFT_ID);
  if (existing !== null && existing.phase === "scheduled") {
    // The write path, real (`PUT /api/leagues/[leagueId]/slot-preference`'s own service): a
    // ranking only takes effect while the draft is still scheduled, so this only runs once —
    // a re-run against an already-started draft would be refused, correctly, and there is
    // nothing left to (re)write.
    const written = await setSlotPreference(db, { leagueId: PREF_LEAGUE_ID, userId: teamOwners[0]!, ranking: PREF_RANKING });
    if (!written.ok) throw new Error(`seedFormatDemos: slot-preference arc's own write was refused: ${written.reason}`);
  }

  const started = await ensureStarted(store, PREF_DRAFT_ID);

  const expectedOrder = draftOrderFor(PREF_DRAFT_ID, teamIds, { [PREF_TEAM_1]: PREF_RANKING });
  const matchedRealDraw = JSON.stringify(started.draftOrder) === JSON.stringify(expectedOrder);
  if (!matchedRealDraw) {
    throw new Error(
      `seedFormatDemos: slot-preference arc's real draftOrder (${JSON.stringify(started.draftOrder)}) didn't match draftOrderFor's own recomputation (${JSON.stringify(expectedOrder)}).`,
    );
  }
  const assignedSlot = expectedOrder.indexOf(PREF_TEAM_1) + 1;

  return { leagueId: PREF_LEAGUE_ID, preferringTeamId: PREF_TEAM_1, assignedSlot, matchedRealDraw };
}

// -------------------------------------------------------------------------------------------
// Arc E: the sit-and-go league that really fills, through the real `joinPublicLeague`
// transaction — never a direct `drafts.kickoff_at` write. Two seats: the commissioner's own
// (seated directly, the identical "every OTHER seeded public league seats its commissioner
// directly and lets a real join fill the rest" shape `seed-public-leagues.ts` already keeps),
// and the second, LAST seat taken through `joinPublicLeague` for real — which is what fires
// `fireWhenFullInTx` (`@/league-service/fill-trigger`) and rewrites `drafts.kickoff_at` from its
// placeholder to `now + MATCHMAKING_CONFIG.sitAndGo.graceSeconds`.
// -------------------------------------------------------------------------------------------

const SIT_AND_GO_LEAGUE_ID = "dev_public_sit_and_go_demo";
const SIT_AND_GO_DRAFT_ID = "dev_public_sit_and_go_demo_draft";
const SIT_AND_GO_TEAM_1 = `${SIT_AND_GO_LEAGUE_ID}_team_1`;

export interface SitAndGoResult {
  readonly leagueId: string;
  readonly filled: boolean;
  readonly kickoffRewritten: boolean;
}

/** The real, LAST-seat join, and whether it rewrote the kickoff — split out of
 *  `seedSitAndGoLeague` purely to bring that function back under the 50-line guideline
 *  (fix round 1, F2). Identical call, identical assertions, identical thrown messages. */
async function joinLastSeatAndCheckKickoff(
  db: Db,
  clock: Clock,
  deps: SeedFormatDemosDeps,
  joinerUserId: string,
  placeholderKickoffAt: Date,
): Promise<boolean> {
  const outcome = await joinPublicLeague(
    { db, newId: () => crypto.randomUUID(), clock, audit: deps.audit },
    { leagueId: SIT_AND_GO_LEAGUE_ID, userId: joinerUserId },
  );
  if (!outcome.ok) {
    throw new Error(`seedFormatDemos: sit-and-go arc's own last-seat join was refused: ${outcome.reason}`);
  }

  const [draftRow] = await db.select({ kickoffAt: drafts.kickoffAt }).from(drafts).where(eq(drafts.id, SIT_AND_GO_DRAFT_ID));
  const kickoffRewritten = draftRow!.kickoffAt.getTime() !== placeholderKickoffAt.getTime();
  // A re-run against an already-filled league takes the `alreadyMember` branch above and writes
  // nothing new — the FIRST run is the one this assertion actually guards.
  if (!kickoffRewritten && !outcome.alreadyMember) {
    throw new Error("seedFormatDemos: sit-and-go arc's last-seat join didn't rewrite the draft's kickoff.");
  }
  return kickoffRewritten;
}

async function seedSitAndGoLeague(db: Db, clock: Clock, deps: SeedFormatDemosDeps): Promise<SitAndGoResult> {
  const owners = await ensureDevUsers(db);
  const commissioner = owners[1]!;
  const joiner = owners[2]!;

  // The un-fired placeholder (`LEAGUE_CONFIG.defaults.draftDaysFromCreation`'s own 7-day shape,
  // `@/league-service/creation.ts`) — a time nobody chose, which is exactly what
  // `fireWhenFullInTx` (inside `joinLastSeatAndCheckKickoff`, below) overwrites for real.
  const placeholderKickoffAt = new Date(Date.parse(clock.now()) + 7 * 24 * 60 * 60 * 1000);
  await insertDemoLeagueShell(db, {
    leagueId: SIT_AND_GO_LEAGUE_ID,
    draftId: SIT_AND_GO_DRAFT_ID,
    name: "Dev Sit-and-Go Demo",
    teamIds: [SIT_AND_GO_TEAM_1],
    teamOwners: [commissioner],
    teamNamePrefix: "Sit-and-Go Demo",
    rosterSlots: STANDARD_ROSTER_SLOTS,
    isPublicMatchmade: true,
    experienceTier: "experienced",
    kickoffAt: placeholderKickoffAt,
    startTrigger: "when_full",
    // Two seats total — this call seats only the commissioner directly; the second is left for
    // `joinLastSeatAndCheckKickoff`'s own real join, below.
    teamCount: 2,
  });

  const kickoffRewritten = await joinLastSeatAndCheckKickoff(db, clock, deps, joiner, placeholderKickoffAt);
  return { leagueId: SIT_AND_GO_LEAGUE_ID, filled: true, kickoffRewritten };
}

// -------------------------------------------------------------------------------------------

export interface SeedFormatDemosResult {
  readonly superflex: SuperflexResult;
  readonly skipAndOwe: SkipAndOweResult;
  readonly slotPreference: SlotPreferenceResult;
  readonly sitAndGo: SitAndGoResult;
}

/**
 * Phase 3.5, Task 10, Step 1, in full (minus the median arc — `seed-season-league.ts`'s own
 * `MEDIAN_DEMO_LEAGUE`). Every arc is independent and small; a failure in one leaves the others
 * untouched (no shared transaction), the same "one write per step, replay-safe" posture every
 * other seed module in this directory keeps.
 */
export async function seedFormatDemos(db: Db, clock: Clock, deps: SeedFormatDemosDeps = {}): Promise<SeedFormatDemosResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedFormatDemos creates placeholder users and must never run in production.");
  }

  const store = deps.store ?? getDraftStore();
  const superflex = await seedSuperflexLeague(db, clock, store);
  const skipAndOwe = await seedSkipAndOweLeague(db, clock, store);
  const slotPreference = await seedSlotPreferenceLeague(db, clock, store);
  const sitAndGo = await seedSitAndGoLeague(db, clock, deps);

  return { superflex, skipAndOwe, slotPreference, sitAndGo };
}
