import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { assembleAdvisorContext } from "@/ai-advisor/context";
import type { Db } from "@/db/client";
import { drafts, leagues, lineupSlots, matchups, rosterSlots, scoringSettings, statWeeks, teams, tradeProposals } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig, type RosterSlotType } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { assignSlot, snakeTeamForPick, totalRosterSlots } from "@/draft-engine";
import { getDraftStore } from "@/draft-service";
import { autoStartDueDrafts } from "@/draft-service/auto-start";
import { rankedPlayers } from "@/draft-service/pool";
import type { DraftStore } from "@/draft-service/store";
import type { AuditLogger } from "@/integrity-service/audit-logger";
import { notifyAffectedMember, type MemberNotice } from "@/integrity-service/notify";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { defaultLineup, LEAGUE_CONFIG } from "@/league";
import { autoSetLineupsForWeek } from "@/league-service/auto-lineup";
import { setLineup, toRosterSlots } from "@/league-service/lineups";
import { acceptTrade, proposeTrade } from "@/league-service/trades";
import { persistTick } from "@/stats-pipeline/persist";
import { TRADE_CONFIG } from "@/trades/config";
import { ensureDevUsers, preserveRealCommissioner, preserveRealTeamOwner } from "./dev-users";

/**
 * Test seam only, mirroring `SeedTradesDeps` (`./seed-trades.ts`): production (`./index.ts`)
 * supplies none of these, so every call underneath runs the real notifier, the real Redis
 * publish and the real audit chain — exactly what "through the real routes" means. A test injects
 * fakes here for the same reason `seed-trades.test.ts` does: this file has no live Redis of its
 * own to fail against. `store` is the one addition beyond that shape — `getDraftStore()` is a
 * process-wide singleton with no seam of its own, so a test supplies its OWN `DraftStore` (a real
 * `createDraftStore` wired to a no-op `deliverNotice`) rather than reaching into the singleton.
 */
export interface SeedEnforcementDeps {
  readonly notify?: typeof notifyAffectedMember;
  readonly deliver?: (notice: MemberNotice) => Promise<void>;
  readonly audit?: AuditLogger;
  readonly store?: DraftStore;
}

/**
 * Phase 3 Plan D, Task 10, Step 2: the three arcs `seed-season-league.ts`'s veteran and
 * `seed-trades.ts`'s three fairness fixtures don't reach — a HELD trade past
 * `INTEGRITY_CONFIG.trade.autoHoldThreshold`, a lineup the platform auto-sets at a real locked
 * week, and a scheduled draft the platform itself starts. Three small, dedicated public
 * matchmade leagues, one per arc — never bolted onto `seed-trades.ts`'s own `dev_league_trades`
 * (that league's bench-only trades top out well under the auto-hold threshold, and its one
 * matchup at week `LEAGUE_CONFIG.maxWeeks` is what keeps `currentWeekOf` answering the week its
 * three existing fixtures need; adding a second, earlier matchup to reach a lockable week would
 * move that answer out from under them) and never onto `seed-public-leagues.ts`'s six browse
 * demos (none of them ever drafts, so none has a roster a trade or a lineup could touch).
 *
 * Every league here is `isPublicMatchmade: true` and stays FULL the moment it is seeded, so none
 * of them ever appears on `/browse` (`hasOpenSeat` excludes it) — these are backstage fixtures
 * for the automated machinery, not additional demo rooms.
 */

const MS_PER_HOUR = 60 * 60 * 1000;

// -------------------------------------------------------------------------------------------
// Shared roster-dealing helper — the identical "snake order over `rankedPlayers`, ask the
// ENGINE's own `assignSlot` where each player fits" discipline `seedSeasonLeague`/`seedTrades`/
// `seedMultiAccountSuspect` each already keep, generalized over the slot config so this file
// deals both a bench-empty roster (the held-trade league) and a full one (the auto-set league)
// through one implementation.
// -------------------------------------------------------------------------------------------

async function dealRosterIfAbsent(db: Db, leagueId: string, teamIds: readonly string[], slotConfig: readonly RosterSlotConfig[]): Promise<void> {
  const [existing] = await db.select({ teamId: rosterSlots.teamId }).from(rosterSlots).where(eq(rosterSlots.teamId, teamIds[0]!)).limit(1);
  if (existing !== undefined) return; // a re-run must never un-trade or un-set what an earlier run already moved.

  const pool = await rankedPlayers(db, leagueId);
  const taken = new Set<string>();
  const rosters = new Map(teamIds.map((id) => [id, [] as { slot: RosterSlotType; slotIndex: number; playerId: string }[]]));
  const totalPicks = teamIds.length * totalRosterSlots(slotConfig);

  for (let pickNumber = 1; pickNumber <= totalPicks; pickNumber++) {
    const teamId = snakeTeamForPick(teamIds, pickNumber);
    const roster = rosters.get(teamId)!;
    const sizeBefore = roster.length;
    for (const player of pool) {
      if (taken.has(player.id)) continue;
      const assignment = assignSlot({ position: player.position, roster, slotConfig });
      if (!assignment.ok) continue;
      taken.add(player.id);
      roster.push({ slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: player.id });
      break;
    }
    if (roster.length === sizeBefore) {
      throw new Error(`seedEnforcement: no eligible player left in the pool for pick ${pickNumber} (team ${teamId}, league ${leagueId}).`);
    }
  }

  const slotRows = [...rosters.entries()].flatMap(([teamId, slots]) => slots.map((slot) => ({ teamId, ...slot })));
  await db.insert(rosterSlots).values(slotRows);
}

/** Every way to choose exactly `size` items from `items`, order-independent — the identical
 *  combinatorial shape `bestBenchCombo` (`seed-trades.ts`) and `e2e/global-setup.ts`'s own
 *  `combinationsOfSize` already keep, not reinvented a third time with different names. */
function combinationsOfSize<T>(items: readonly T[], size: number): readonly (readonly T[])[] {
  if (size === 0) return [[]];
  if (size > items.length) return [];
  const [head, ...rest] = items;
  const withHead = combinationsOfSize(rest, size - 1).map((combo) => [head!, ...combo]);
  const withoutHead = combinationsOfSize(rest, size);
  return [...withHead, ...withoutHead];
}

// -------------------------------------------------------------------------------------------
// Arc 1: the held trade. A `held_trade`-subject `trade_hold` flag — the last flag type the
// operator queue can hold (Plan B ruling 29 made `trade_fairness` real; Plan C ruling 28 wired
// the fairness flag; this is the fourth and final one).
// -------------------------------------------------------------------------------------------

const HELD_TRADE_LEAGUE_ID = "dev_public_trade_hold";
const HELD_TRADE_DRAFT_ID = "dev_public_trade_hold_draft";
const HELD_TRADE_TEAM_A = `${HELD_TRADE_LEAGUE_ID}_team_a`;
const HELD_TRADE_TEAM_B = `${HELD_TRADE_LEAGUE_ID}_team_b`;
const HELD_TRADE_ID = `${HELD_TRADE_LEAGUE_ID}_trade`;
/** Same choice `seed-trades.ts` makes, and for the identical reason (see that file's own
 *  docblock): a week past `LEAGUE_CONFIG.regularSeasonWeeks` that the ingestion worker's own
 *  ticking can never reach, so this league's one matchup stays the earliest — and therefore
 *  only — answer `currentWeekOf` can ever give it, and stays unlocked forever. */
const HELD_TRADE_WEEK_NUMBER = LEAGUE_CONFIG.maxWeeks;
/** Bench-empty rosters (`STANDARD_ROSTER_SLOTS` minus `BENCH`), the identical trick
 *  `e2e/global-setup.ts`'s own trades fixture uses: every slot either side gives up is
 *  immediately backfilled from the other side's equal-count package, so ANY equal-count starter
 *  swap always finds room on both rosters without this file needing to simulate
 *  `plannedTransfer` to know it is legal. Bench-only packages (`seed-trades.ts`'s own approach)
 *  top out well under `INTEGRITY_CONFIG.trade.autoHoldThreshold` for a league this size —
 *  starters are worth more, and reaching the hold threshold needs them. */
const STARTER_ONLY_SLOTS = STANDARD_ROSTER_SLOTS.filter((slot) => slot.slot !== "BENCH");

interface HeldTradeResult {
  readonly leagueId: string;
  readonly tradeId: string | null;
  readonly outcome: "held" | "skipped_no_threshold";
}

async function seedHeldTradeLeague(db: Db, clock: Clock, deps: SeedEnforcementDeps): Promise<HeldTradeResult> {
  const owners = await ensureDevUsers(db);
  // Indices 1 and 2 — clear of index 0 (the claim slot every browsable public league also now
  // skips, `seed-public-leagues.ts`'s own docblock) and reused deliberately, the same
  // "a dev user fielding one more team is what a real member joining a second league looks
  // like" reasoning `seed-trades.ts` and `seed-integrity.ts` both already state.
  const ownerA = owners[1]!;
  const ownerB = owners[2]!;
  const teamIds = [HELD_TRADE_TEAM_A, HELD_TRADE_TEAM_B];

  await db
    .insert(leagues)
    .values({
      id: HELD_TRADE_LEAGUE_ID,
      name: "Dev Trade Hold League",
      format: "snake",
      teamCount: teamIds.length,
      isPublicMatchmade: true,
      experienceTier: "experienced",
      commissionerUserId: ownerA,
      rosterSlots: [...STANDARD_ROSTER_SLOTS],
    })
    .onConflictDoUpdate({ target: leagues.id, set: { isPublicMatchmade: true, commissionerUserId: preserveRealCommissioner() } });

  await db.insert(scoringSettings).values({ leagueId: HELD_TRADE_LEAGUE_ID, ...PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(teamIds.map((id, i) => ({ id, leagueId: HELD_TRADE_LEAGUE_ID, userId: [ownerA, ownerB][i]!, name: `Trade Hold Fixture ${i + 1}` })))
    .onConflictDoUpdate({ target: teams.id, set: { userId: preserveRealTeamOwner() } });

  await db
    .insert(drafts)
    .values({ id: HELD_TRADE_DRAFT_ID, leagueId: HELD_TRADE_LEAGUE_ID, format: "snake", status: "complete", kickoffAt: new Date(clock.now()), auctionBudget: null })
    .onConflictDoNothing({ target: drafts.id });

  await db
    .insert(matchups)
    .values({ leagueId: HELD_TRADE_LEAGUE_ID, weekNumber: HELD_TRADE_WEEK_NUMBER, homeTeamId: HELD_TRADE_TEAM_A, awayTeamId: HELD_TRADE_TEAM_B })
    .onConflictDoNothing();

  await dealRosterIfAbsent(db, HELD_TRADE_LEAGUE_ID, teamIds, STARTER_ONLY_SLOTS);

  // `INTEGRITY_CONFIG.trade.autoHoldThreshold` is a rollback-capable `number | null` (Task 5's
  // own docblock, `enforceTierSegregation`'s sibling switch). `null` means the platform holds no
  // trade at all — this arc has nothing to demonstrate, and skipping it honestly beats forcing a
  // hold the real gate would never grant.
  const autoHoldThreshold = INTEGRITY_CONFIG.trade.autoHoldThreshold;
  if (autoHoldThreshold === null) {
    return { leagueId: HELD_TRADE_LEAGUE_ID, tradeId: null, outcome: "skipped_no_threshold" };
  }

  const [existing] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, HELD_TRADE_ID));
  if (existing !== undefined) {
    if (existing.status === "held") return { leagueId: HELD_TRADE_LEAGUE_ID, tradeId: existing.id, outcome: "held" };
    if (existing.status === "open") {
      const acceptResult = await acceptTrade(db, {
        bypassDeadline: true, tradeId: existing.id, leagueId: HELD_TRADE_LEAGUE_ID, userId: ownerB, clock, notify: deps.notify, deliver: deps.deliver, audit: deps.audit });
      if (!acceptResult.ok || acceptResult.outcome !== "held") {
        throw new Error(`seedEnforcement: resuming the held-trade fixture didn't hold: ${JSON.stringify(acceptResult)}`);
      }
      return { leagueId: HELD_TRADE_LEAGUE_ID, tradeId: acceptResult.tradeId, outcome: "held" };
    }
    throw new Error(`seedEnforcement: the held-trade fixture (${HELD_TRADE_ID}) is "${existing.status}", not "held" — something else settled it.`);
  }

  const [contextA, contextB] = await Promise.all([
    assembleAdvisorContext(db, { leagueId: HELD_TRADE_LEAGUE_ID, teamId: HELD_TRADE_TEAM_A, weekNumber: HELD_TRADE_WEEK_NUMBER }),
    assembleAdvisorContext(db, { leagueId: HELD_TRADE_LEAGUE_ID, teamId: HELD_TRADE_TEAM_B, weekNumber: HELD_TRADE_WEEK_NUMBER }),
  ]);
  if (contextA === null || contextB === null) {
    throw new Error(`seedEnforcement: a team doesn't resolve in ${HELD_TRADE_LEAGUE_ID} yet.`);
  }
  const playersA = contextA.me.players;
  const playersB = contextB.me.players;

  let best: { readonly give: readonly string[]; readonly get: readonly string[]; readonly gap: number } | null = null;
  const maxSize = Math.min(TRADE_CONFIG.maxAssetsPerSide, playersA.length, playersB.length);
  for (let size = 1; size <= maxSize; size++) {
    for (const give of combinationsOfSize(playersA, size)) {
      const giveSum = give.reduce((total, player) => total + player.averagePoints, 0);
      for (const get of combinationsOfSize(playersB, size)) {
        const getSum = get.reduce((total, player) => total + player.averagePoints, 0);
        const gap = Math.abs(giveSum - getSum);
        if (gap < autoHoldThreshold) continue;
        if (best === null || gap > best.gap) best = { give: give.map((p) => p.playerId), get: get.map((p) => p.playerId), gap };
      }
    }
  }
  if (best === null) {
    throw new Error(`seedEnforcement: no combination of ${HELD_TRADE_LEAGUE_ID}'s dealt starters reaches the auto-hold threshold (${autoHoldThreshold}).`);
  }

  const proposeResult = await proposeTrade(db, {
    // Seeder-manufactured history: the calendar deadline is bypassed, every other rule binds.
    bypassDeadline: true,
    leagueId: HELD_TRADE_LEAGUE_ID,
    userId: ownerA,
    counterpartyTeamId: HELD_TRADE_TEAM_B,
    proposerAssets: best.give.map((playerId) => ({ kind: "player" as const, playerId })),
    counterpartyAssets: best.get.map((playerId) => ({ kind: "player" as const, playerId })),
    note: "This one is getting a second look before anything moves.",
    clock,
    newId: () => HELD_TRADE_ID,
    notify: deps.notify,
    deliver: deps.deliver,
    audit: deps.audit,
  });
  if (!proposeResult.ok) {
    throw new Error(`seedEnforcement: the held-trade fixture's own proposal was refused: ${proposeResult.reason}`);
  }

  const acceptResult = await acceptTrade(db, {
        bypassDeadline: true, tradeId: proposeResult.tradeId, leagueId: HELD_TRADE_LEAGUE_ID, userId: ownerB, clock, notify: deps.notify, deliver: deps.deliver, audit: deps.audit });
  if (!acceptResult.ok) {
    throw new Error(`seedEnforcement: the held-trade fixture's own acceptance was refused: ${acceptResult.reason}`);
  }
  if (acceptResult.outcome !== "held") {
    throw new Error(`seedEnforcement: the held-trade fixture (gap ${best.gap}) executed instead of holding — the auto-hold gate didn't fire.`);
  }

  return { leagueId: HELD_TRADE_LEAGUE_ID, tradeId: acceptResult.tradeId, outcome: "held" };
}

// -------------------------------------------------------------------------------------------
// Arc 2: the lineup the platform auto-sets. One manager's week is left unset at a REAL locked
// week, so `autoSetLineupsForWeek` (`@/league-service/auto-lineup`, Task 4) materializes it for
// real and delivers the `subject_only` notice only that one seeded account can see.
// -------------------------------------------------------------------------------------------

const AUTOSET_LEAGUE_ID = "dev_public_lineup_autoset";
const AUTOSET_DRAFT_ID = "dev_public_lineup_autoset_draft";
const AUTOSET_TEAM_1 = `${AUTOSET_LEAGUE_ID}_team_1`;
const AUTOSET_TEAM_2 = `${AUTOSET_LEAGUE_ID}_team_2`;
const AUTOSET_TARGET_TEAM = `${AUTOSET_LEAGUE_ID}_team_3`;

interface AutoSetWeeks {
  readonly previousWeek: number;
  readonly targetWeek: number;
}

/**
 * Which two consecutive weeks this league's own arc plays out at — resolved once, never
 * hardcoded, for two independent reasons:
 *
 * REUSE, on a re-run: this league's own EARLIEST matchup row, if one already exists, names the
 * pair a prior run already committed to (`targetWeek = previousWeek + 1` by construction, see
 * below) — reusing it is what keeps a re-run idempotent rather than picking a fresh pair every
 * time and leaving the old one stranded.
 *
 * FRESH, on the first run: `stat_weeks` is GLOBAL, never scoped to a league, and on a long-lived
 * dev database the real ingestion worker (or an earlier `e2e` run's own ticking) may already have
 * locked weeks this seed does not own. Hardcoding weeks 1-2 broke against exactly that database
 * while building this task: `ensureLineupSaved`'s own pre-lock writes were refused because week 2
 * was ALREADY `final`. The honest fix is to ask what the real worker has already locked and start
 * one past it, the same "read the real state, never assume a fresh table" discipline
 * `weeksToExamine`'s own cold-start fix keeps (`@/stats-pipeline/worker.ts`).
 */
async function resolveAutoSetWeeks(db: Db): Promise<AutoSetWeeks> {
  const [existingMatchup] = await db
    .select({ weekNumber: matchups.weekNumber })
    .from(matchups)
    .where(eq(matchups.leagueId, AUTOSET_LEAGUE_ID))
    .orderBy(asc(matchups.weekNumber))
    .limit(1);
  if (existingMatchup !== undefined) {
    return { previousWeek: existingMatchup.weekNumber, targetWeek: existingMatchup.weekNumber + 1 };
  }

  const [row] = await db
    .select({ lastLocked: sql<number | null>`max(${statWeeks.week})` })
    .from(statWeeks)
    .where(inArray(statWeeks.status, ["in_progress", "final"]));
  const lastLocked = row?.lastLocked ?? 0;
  return { previousWeek: lastLocked + 1, targetWeek: lastLocked + 2 };
}

/**
 * `stat_weeks` is GLOBAL, never scoped to a league, and its own real writer is `persistTick`
 * (`@/stats-pipeline/persist.ts`) — called here directly with an empty `changed` list (every
 * player's own stat line for these early weeks was already written by `seedPlayers`, at the top
 * of `npm run seed`) rather than through the full ingestion worker, the same "call the real
 * write, skip the orchestration around it" discipline `seedSeasonLeague` already uses for
 * `finalizeWeek`. `status: "final"` for BOTH weeks `resolveAutoSetWeeks` chose — contiguous with
 * whatever the real worker had already locked, so a real worker that later runs against this same
 * database sees a season that genuinely progressed and correctly resumes past it, rather than a
 * stray final week with a gap before it (`examinationWindow`, `@/stats-pipeline/worker.ts`).
 */
async function lockWeeksForAutoSet(db: Db, clock: Clock, weeks: AutoSetWeeks): Promise<void> {
  for (const week of [weeks.previousWeek, weeks.targetWeek]) {
    await persistTick(db, { week, changed: [], status: "final", games: { total: 16, final: 16 }, now: clock.now() });
  }
}

/** Saves a team's own default lineup (whatever the draft already dealt it — `defaultLineup` over
 *  its `roster_slots`) for one week, through the real `setLineup` route, unless a row for that
 *  team and week already exists. Idempotent the same way `dealRosterIfAbsent` is: a re-run after
 *  the target week has locked must never attempt (and be refused) a save this file already made
 *  on an earlier run. */
async function ensureLineupSaved(db: Db, leagueId: string, teamId: string, userId: string, weekNumber: number, clock: Clock, audit: AuditLogger | undefined): Promise<void> {
  const [existing] = await db
    .select({ teamId: lineupSlots.teamId })
    .from(lineupSlots)
    .where(and(eq(lineupSlots.teamId, teamId), eq(lineupSlots.weekNumber, weekNumber)))
    .limit(1);
  if (existing !== undefined) return;

  const rosterRows = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamId));
  const lineup = defaultLineup(STANDARD_ROSTER_SLOTS, toRosterSlots(rosterRows));
  const result = await setLineup(db, { leagueId, teamId, weekNumber, userId, slots: lineup }, undefined, { clock, audit });
  if (!result.ok) {
    throw new Error(`seedEnforcement: couldn't save team ${teamId}'s week ${weekNumber} lineup: ${result.reason}`);
  }
}

interface LineupAutoSetResult {
  readonly leagueId: string;
  readonly teamsSet: number;
}

async function seedLineupAutoSetLeague(db: Db, clock: Clock, deps: SeedEnforcementDeps): Promise<LineupAutoSetResult> {
  const owners = await ensureDevUsers(db);
  // Indices 3, 4 and 5 — clear of the held-trade league's own 1 and 2.
  const owner1 = owners[3]!;
  const owner2 = owners[4]!;
  const ownerTarget = owners[5]!;
  const teamIds = [AUTOSET_TEAM_1, AUTOSET_TEAM_2, AUTOSET_TARGET_TEAM];

  await db
    .insert(leagues)
    .values({
      id: AUTOSET_LEAGUE_ID,
      name: "Dev Lineup Auto-Set League",
      format: "snake",
      teamCount: teamIds.length,
      isPublicMatchmade: true,
      experienceTier: "experienced",
      commissionerUserId: owner1,
      rosterSlots: [...STANDARD_ROSTER_SLOTS],
    })
    .onConflictDoUpdate({ target: leagues.id, set: { isPublicMatchmade: true, commissionerUserId: preserveRealCommissioner() } });

  await db.insert(scoringSettings).values({ leagueId: AUTOSET_LEAGUE_ID, ...PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(teamIds.map((id, i) => ({ id, leagueId: AUTOSET_LEAGUE_ID, userId: [owner1, owner2, ownerTarget][i]!, name: `Auto-Set Fixture ${i + 1}` })))
    .onConflictDoUpdate({ target: teams.id, set: { userId: preserveRealTeamOwner() } });

  await db
    .insert(drafts)
    .values({ id: AUTOSET_DRAFT_ID, leagueId: AUTOSET_LEAGUE_ID, format: "snake", status: "complete", kickoffAt: new Date(clock.now()), auctionBudget: null })
    .onConflictDoNothing({ target: drafts.id });

  const weeks = await resolveAutoSetWeeks(db);

  // Two matchup rows (team 1 vs team 2, both weeks) — the target team never needs to appear in
  // one: `setLineup`'s own week-exists check and `autoSetLineupsForWeek`'s own league discovery
  // (`leaguesInWeek`) both key on the LEAGUE having a matchup that week, never on which two teams
  // it names.
  await db
    .insert(matchups)
    .values([
      { leagueId: AUTOSET_LEAGUE_ID, weekNumber: weeks.previousWeek, homeTeamId: AUTOSET_TEAM_1, awayTeamId: AUTOSET_TEAM_2 },
      { leagueId: AUTOSET_LEAGUE_ID, weekNumber: weeks.targetWeek, homeTeamId: AUTOSET_TEAM_1, awayTeamId: AUTOSET_TEAM_2 },
    ])
    .onConflictDoNothing();

  await dealRosterIfAbsent(db, AUTOSET_LEAGUE_ID, teamIds, STANDARD_ROSTER_SLOTS);

  // BEFORE the lock, while both weeks are still open: team 1 and 2 set their OWN target-week
  // lineup by hand (so the auto-set leaves them alone), and the target team sets only its
  // PREVIOUS week's — the one `autoSetLineupInTx` will carry forward.
  await ensureLineupSaved(db, AUTOSET_LEAGUE_ID, AUTOSET_TEAM_1, owner1, weeks.targetWeek, clock, deps.audit);
  await ensureLineupSaved(db, AUTOSET_LEAGUE_ID, AUTOSET_TEAM_2, owner2, weeks.targetWeek, clock, deps.audit);
  await ensureLineupSaved(db, AUTOSET_LEAGUE_ID, AUTOSET_TARGET_TEAM, ownerTarget, weeks.previousWeek, clock, deps.audit);

  await lockWeeksForAutoSet(db, clock, weeks);

  // The real production sweep (Task 4), never a direct write to `lineup_slots` — this is what
  // materializes the target team's week-2 row, delivers its `lineup_auto_set` notice and appends
  // the `subject_only` `system_action` only that one account can see.
  const result = await autoSetLineupsForWeek(db, {
    weekNumber: weeks.targetWeek,
    occurredAt: clock.now(),
    audit: deps.audit,
    notify: deps.notify,
    deliver: deps.deliver,
  });
  return { leagueId: AUTOSET_LEAGUE_ID, teamsSet: result.teamsSet };
}

// -------------------------------------------------------------------------------------------
// Arc 3: the draft the platform starts. A scheduled draft whose kickoff is already in the past,
// started by the real ticker action (`autoStartDueDrafts`, Task 7) — never `startDraft` called
// directly, which would be the seed pretending to be the commissioner rather than the platform.
// -------------------------------------------------------------------------------------------

const AUTOSTART_LEAGUE_ID = "dev_public_draft_autostart";
const AUTOSTART_DRAFT_ID = "dev_public_draft_autostart_draft";

interface DraftAutoStartResult {
  readonly draftId: string;
  readonly started: boolean;
}

async function seedDraftAutoStartLeague(db: Db, clock: Clock, deps: SeedEnforcementDeps): Promise<DraftAutoStartResult> {
  const owners = await ensureDevUsers(db);
  // Indices 6 and 7 — clear of the two leagues above.
  const teamOwners = [owners[6]!, owners[7]!];
  const teamIds = teamOwners.map((_, i) => `${AUTOSTART_LEAGUE_ID}_team_${i + 1}`);

  await db
    .insert(leagues)
    .values({
      id: AUTOSTART_LEAGUE_ID,
      name: "Dev Draft Auto-Start League",
      format: "snake",
      teamCount: teamIds.length,
      isPublicMatchmade: true,
      experienceTier: "experienced",
      commissionerUserId: teamOwners[0]!,
      rosterSlots: [...STANDARD_ROSTER_SLOTS],
    })
    .onConflictDoUpdate({ target: leagues.id, set: { isPublicMatchmade: true, commissionerUserId: preserveRealCommissioner() } });

  await db.insert(scoringSettings).values({ leagueId: AUTOSTART_LEAGUE_ID, ...PPR_SCORING }).onConflictDoNothing({ target: scoringSettings.leagueId });

  await db
    .insert(teams)
    .values(teamIds.map((id, i) => ({ id, leagueId: AUTOSTART_LEAGUE_ID, userId: teamOwners[i]!, name: `Auto-Start Fixture ${i + 1}` })))
    .onConflictDoUpdate({ target: teams.id, set: { userId: preserveRealTeamOwner() } });

  // Recomputed from `clock.now()` on every run, like `seed-public-leagues.ts`'s own kickoff:
  // once `autoStartDueDrafts` claims it, `drafts.status` is no longer `"scheduled"` and this
  // `onConflictDoUpdate` never touches status at all, so a re-run can't un-start it.
  const kickoffAt = new Date(Date.parse(clock.now()) - MS_PER_HOUR);
  await db
    .insert(drafts)
    .values({ id: AUTOSTART_DRAFT_ID, leagueId: AUTOSTART_LEAGUE_ID, format: "snake", status: "scheduled", kickoffAt, auctionBudget: null })
    .onConflictDoUpdate({ target: drafts.id, set: { kickoffAt } });

  // The real sweep action (`@/draft-service/auto-start`) — the SAME function the minute sweep
  // (`@/jobs/defs/draft-sweep-job`) calls on every fire, called here directly rather than through
  // a running sweep. Never `store.startDraft` directly: that would be the
  // seed pretending to be the commissioner's manual press, not the platform's own hand.
  await autoStartDueDrafts(db, { store: deps.store ?? getDraftStore(), clock });

  const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, AUTOSTART_DRAFT_ID));
  return { draftId: AUTOSTART_DRAFT_ID, started: row?.status === "in_progress" };
}

// -------------------------------------------------------------------------------------------

export interface SeedEnforcementResult {
  readonly heldTrade: HeldTradeResult;
  readonly lineupAutoSet: LineupAutoSetResult;
  readonly draftAutoStart: DraftAutoStartResult;
}

/**
 * Phase 3 Plan D, Task 10, Step 2, in full: the held trade, the auto-set lineup and the
 * platform-started draft, each through its own real production path and each in its own small,
 * dedicated public matchmade league. See this file's own opening docblock for why none of the
 * three reuses an existing seeded league.
 */
export async function seedEnforcement(db: Db, clock: Clock, deps: SeedEnforcementDeps = {}): Promise<SeedEnforcementResult> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedEnforcement creates placeholder users and must never run in production.");
  }

  const heldTrade = await seedHeldTradeLeague(db, clock, deps);
  const lineupAutoSet = await seedLineupAutoSetLeague(db, clock, deps);
  const draftAutoStart = await seedDraftAutoStartLeague(db, clock, deps);

  return { heldTrade, lineupAutoSet, draftAutoStart };
}
