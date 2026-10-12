import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { auditEvents, draftActions, draftSlotPreferences, drafts, leagues, teams } from "@/db/schema";
import type { DraftStatus } from "@research-ts/domain/draft";
import type { Clock } from "@research-ts/domain/timing";
import { draftActionSchema } from "@/draft-engine";
import { LEAGUE_CONFIG } from "@/league";
import type { DraftScheduleBody, SlotPreferenceView } from "@/league-room/contract";
import { HOUSE_AUTHORITY_REFUSALS, isCommissionerOf } from "./authority";
import { MS_PER_DAY } from "./config";

/** The outermost edge is the only place a wall clock is allowed — see every other service
 *  module's identical constant (`creation.ts`, `invites.ts`, `lineups.ts`, ...). */
const systemClock: Clock = { now: () => new Date().toISOString() };

/** Answered when the league or its draft can't be found, AND when the caller is a real member
 *  of a real league but not its commissioner — the same 404, for the same non-oracle reason
 *  `publicJoinPrecondition` and `withAdmin` already answer 404 rather than 403 (ruling 14): a
 *  caller who is not allowed to act on this draft learns nothing about whether a different
 *  draft exists that they also can't act on. */
const DRAFT_NOT_FOUND = "That draft does not exist.";

/**
 * The three refusals `setDraftKickoff` can give for an otherwise-authorized request, named once
 * so the service and its tests never hand-type a second copy of the same sentence.
 */
export const KICKOFF_REFUSALS = {
  alreadyStarted: "This draft has already started, so its time cannot change.",
  /**
   * Phase 3.5, Task 7. A `'when_full'` draft's `kickoff_at` is set by `fireWhenFullInTx`
   * (`@/league-service/fill-trigger`), not by a commissioner — a time nobody chose is not a time
   * anybody may edit. Checked before the past/too-far checks below: those are about WHETHER a
   * chosen time is a reasonable one, and this is about whether there is a time to choose at all.
   */
  whenFull: "This draft starts when the league fills, so nobody sets its time by hand.",
  past: "Pick a time in the future so everyone has a chance to show up.",
  /**
   * Names `LEAGUE_CONFIG.defaults.maxDraftDaysAhead` rather than repeating the number as a bare
   * literal, so a future change to that config value can never leave this sentence describing a
   * ceiling that no longer exists.
   *
   * Fix round 1 (review HIGH): shipped with an em dash until this round — a real 422 reason this
   * string reaches (`PUT /api/leagues/[leagueId]/draft-schedule`'s error body, rendered verbatim
   * in `draft-schedule-panel.tsx`'s `role="alert"` element) is member-facing copy, not
   * engineering prose, and the founder's "no em dash" rule applies to it in full. It escaped
   * `league-service-copy.source.test.ts`'s sweep specifically because it is a template literal
   * WITH an interpolation — `literalsIn` (`@/integrity/test-support`) excluded every backtick
   * literal containing `$` outright, not just the interpolated part. That extractor is fixed in
   * the same commit as this sentence; see its own docblock for what changed and
   * `league-service-copy.source.test.ts`'s "catches a dash inside an interpolated template
   * literal" test for the proof.
   */
  tooFar:
    `Pick a time within ${LEAGUE_CONFIG.defaults.maxDraftDaysAhead} days from now. Any further out and the draft clock ` +
    "would sit at its widest tier for months before draft night got close.",
} as const;

interface DraftRow {
  readonly draftId: string;
  readonly status: DraftStatus;
  readonly kickoffAt: Date;
  readonly commissionerUserId: string | null;
  /** Phase 3.5 addendum, Task 12: which catalog rung this league came from, or `null` for a
   *  member league — the second half of `@/league-service/authority`'s `LeagueAuthorityRow`. */
  readonly houseRung: string | null;
  readonly isPublicMatchmade: boolean;
  /** Task 6: how many draft slots this league has — the ranking ceiling. */
  readonly teamCount: number;
  /** Phase 3.5, Task 8: which of the two ways this draft's `kickoffAt` comes to be set. */
  readonly startTrigger: "scheduled" | "when_full";
  /** Phase 3.6, Task 7: how many times the roll has pushed this draft's kickoff forward. */
  readonly kickoffRolls: number;
}

/** One league's draft row, joined to the one fact about its league every caller here needs:
 *  who commissions it. `drafts_league_id_idx` (`@research-ts/db/schema`) makes this a unique lookup. */
async function draftRowForLeague(db: Db, leagueId: string): Promise<DraftRow | undefined> {
  const [row] = await db
    .select({
      draftId: drafts.id,
      status: drafts.status,
      kickoffAt: drafts.kickoffAt,
      commissionerUserId: leagues.commissionerUserId,
      houseRung: leagues.houseRung,
      isPublicMatchmade: leagues.isPublicMatchmade,
      teamCount: leagues.teamCount,
      startTrigger: drafts.startTrigger,
      kickoffRolls: drafts.kickoffRolls,
    })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(eq(drafts.leagueId, leagueId));
  return row;
}

/**
 * The slot this team actually drafted from, read straight off the `START_DRAFT` action's own
 * `draftOrder` (sequence 1) — the draw's snapshot, per ruling 27, never a replay. `null` for a
 * draft that hasn't started (no such row yet) or, in principle, a team missing from that
 * snapshot, which cannot happen through ordinary use: every team row present when `startDraft`
 * ran is in `draftOrder` by construction (`@/draft-service/store`).
 */
async function resolvedSlotFor(db: Db, draftId: string, teamId: string): Promise<number | null> {
  const [row] = await db
    .select({ action: draftActions.action })
    .from(draftActions)
    .where(and(eq(draftActions.draftId, draftId), eq(draftActions.sequence, 1)));
  if (row === undefined) return null;
  const parsed = draftActionSchema.safeParse(row.action);
  if (!parsed.success || parsed.data.type !== "START_DRAFT") return null;
  const index = parsed.data.draftOrder.indexOf(teamId);
  return index === -1 ? null : index + 1;
}

/**
 * The caller's own MOST RECENT `member_joined` audit event for this league, or `null` for a
 * caller with no team here (or, never true in production, one whose seat predates the audit
 * chain). `joinLeagueInTx` (`./join.ts`) writes this event unconditionally through both doors
 * into a league, so it is the durable fact `DraftScheduleBody.missedDraft` and
 * `LeagueHomeBody.justSeated` (`./read.ts`, D1) both derive from in place of a `teams.created_at`
 * column this schema does not carry. Shared here so the two readers can never disagree about the
 * same moment.
 */
export async function joinedAtFor(db: Db, params: { readonly leagueId: string; readonly userId: string | null }): Promise<Date | null> {
  if (params.userId === null) return null;
  const [row] = await db
    .select({ occurredAt: auditEvents.occurredAt })
    .from(auditEvents)
    .where(and(eq(auditEvents.leagueId, params.leagueId), eq(auditEvents.actorId, params.userId), eq(auditEvents.eventType, "member_joined")))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(1);
  return row?.occurredAt ?? null;
}

/** `DraftScheduleBody.missedDraft`'s own docblock, shared so `draftScheduleView` and `leagueHome`
 *  (`./read.ts`) never compute it two different ways. */
export function missedDraftFrom(status: DraftStatus, joinedAt: Date | null, kickoffAt: Date): boolean {
  return status === "complete" && joinedAt !== null && joinedAt.getTime() >= kickoffAt.getTime();
}

/**
 * `DraftScheduleBody.slotPreference` for one team — `null` only for a caller with no team in
 * this league (`teamId === null`), since a ranking is scoped to a team. Shared by
 * `draftScheduleView` below (the route's own read) and `leagueHome` (`./read`, the page's
 * initial render), so the two can never compute this differently.
 */
export async function slotPreferenceViewFor(
  db: Db,
  params: { readonly draftId: string; readonly status: DraftStatus; readonly teamId: string | null; readonly slotCount: number },
): Promise<SlotPreferenceView | null> {
  if (params.teamId === null) return null;
  const [row] = await db
    .select({ ranking: draftSlotPreferences.ranking })
    .from(draftSlotPreferences)
    .where(and(eq(draftSlotPreferences.draftId, params.draftId), eq(draftSlotPreferences.teamId, params.teamId)));
  const assignedSlot = params.status === "scheduled" ? null : await resolvedSlotFor(db, params.draftId, params.teamId);
  return {
    slotCount: params.slotCount,
    ranking: row?.ranking ?? [],
    assignedSlot,
    canEdit: params.status === "scheduled",
  };
}

/**
 * What every league member reads: the chosen time, the draft's state, and whether the platform
 * has a fallback (Task 7) — plus, Task 6, the caller's OWN slot ranking and its result, and,
 * Task 8, the trigger and the fill count `WaitingRoom` renders from. Null for a league that
 * doesn't exist — the route answers 404, the same shape every other league read in this service
 * uses for a missing league.
 *
 * ONE read of `teams`, not two: the caller's own team and the league's whole fill count both come
 * off the SAME `{ id, userId }` select, the same "read once, derive twice" shape `leagueHome`
 * (`./read`) uses for its own `teamRows` — a second, count-only query here would cost a round
 * trip this function has never paid.
 */
export async function draftScheduleView(db: Db, leagueId: string, userId: string): Promise<DraftScheduleBody | null> {
  const row = await draftRowForLeague(db, leagueId);
  if (row === undefined) return null;
  const teamRows = await db.select({ id: teams.id, userId: teams.userId }).from(teams).where(eq(teams.leagueId, leagueId));
  const myTeam = teamRows.find((team) => team.userId === userId);
  // `joinedAtFor`'s own null-guard, mirrored here exactly as `leagueHome` (`./read.ts`) applies
  // it: a caller with no team in THIS league right now (never true through `withLeagueMemberActor`
  // today, but this function is called directly in tests and may gain other callers) must never
  // resolve to a STALE `member_joined` event from a seat they have since released — `missedDraft`
  // is a fact about the caller's CURRENT team, not their history with the league.
  const joinedAt = await joinedAtFor(db, { leagueId, userId: myTeam === undefined ? null : userId });
  return {
    draftId: row.draftId,
    leagueId,
    status: row.status,
    kickoffAt: row.kickoffAt.toISOString(),
    isPublicMatchmade: row.isPublicMatchmade,
    startTrigger: row.startTrigger,
    kickoffRolls: row.kickoffRolls,
    filledTeams: teamRows.length,
    slotPreference: await slotPreferenceViewFor(db, {
      draftId: row.draftId,
      status: row.status,
      teamId: myTeam?.id ?? null,
      slotCount: row.teamCount,
    }),
    missedDraft: missedDraftFrom(row.status, joinedAt, row.kickoffAt),
  };
}

export interface SetDraftKickoffInput {
  readonly leagueId: string;
  readonly userId: string;
  /** ISO instant. */
  readonly kickoffAt: string;
}

export type SetDraftKickoffResult =
  | { readonly ok: true; readonly kickoffAt: string }
  | { readonly ok: false; readonly status: number; readonly reason: string };

/**
 * The commissioner's own control over the button Phase 1 built and nobody could ever press
 * on purpose (`POST /api/drafts/[draftId]/start`, correct since Phase 1, reachable only by
 * curl until this task). Moves `drafts.kickoff_at` while the draft is still `scheduled`, and
 * refuses everyone and everything else.
 *
 * Phase 3.5 addendum, Task 12: a house league answers `HOUSE_AUTHORITY_REFUSALS.schedule`
 * instead of the ordinary member's 404 — the same generalization Task 7's `KICKOFF_REFUSALS.
 * whenFull` already makes for a `'when_full'` draft (nobody chose the time, so nobody edits it),
 * extended to a draft nobody could have chosen because the catalog opened the league around it.
 *

 * Locks the league row and then the draft row `FOR UPDATE` before checking anything, so two
 * concurrent reschedules (or a reschedule racing `startDraft`) resolve one at a time rather than
 * both reading `scheduled` and both deciding they may proceed. PROVEN, not promised (final review
 * F10 — this docblock asserted the property and nothing measured it):
 * `src/integrity-service/lock-order.test.ts`'s "setDraftKickoff's row lock" drives both races on
 * two real connections. NO-WRITE-BEFORE-REFUSAL holds here exactly as it does at `createLeague`'s
 * own gate: every refusal branch below returns before the `UPDATE` statement is ever reached, so a
 * refused reschedule commits nothing but the row locks it already had to take to ask the question
 * safely.
 *
 * THE GLOBAL LEAGUES-BEFORE-DRAFTS RULE (final whole-branch review, F1 — a cycle reproduced with
 * three real `psql` sessions, SQLSTATE 40P01). This function used to take BOTH rows in ONE
 * statement: `.for("update")` spanning the `innerJoin` locks every table in the `FROM` list, and
 * within a single statement Postgres acquires those row locks in whatever order it happens to
 * fetch them — which for this plan (`drafts_league_id_idx` first, then the `leagues` lookup) is
 * DRAFTS BEFORE LEAGUES. `joinLeagueInTx` (`./join.ts`) goes the other way: `leagues FOR UPDATE`,
 * then `fireWhenFullInTx`'s `UPDATE drafts`. Two transactions, two orders, one cycle.
 *
 * The rule this branch now holds everywhere, stated once here and restated at every other site
 * that obeys it: ANY TRANSACTION THAT TAKES BOTH A `leagues` ROW LOCK AND A `drafts` ROW LOCK
 * ACQUIRES `leagues` FIRST, AS ITS OWN STATEMENT. So the first statement below locks the league
 * row alone, and the joined read that follows narrows its lock to `drafts` (`FOR UPDATE OF
 * drafts`) — the league row it joins through is already held by the statement above it, and the
 * new-edge-free order is leagues-then-drafts in both directions. Driven, not asserted:
 * `lock-order.test.ts`'s "the leagues-before-drafts rule" block runs the previously-cyclic pair on
 * two real connections with the old order's timing.
 */
export async function setDraftKickoff(
  db: Db,
  input: SetDraftKickoffInput,
  clock: Clock = systemClock,
): Promise<SetDraftKickoffResult> {
  return db.transaction(async (tx) => {
    // LEAGUES FIRST, ON ITS OWN (F1 — see the docblock above). A league with no `drafts` row is
    // not a reachable state through this product, but locking a row that exists while the joined
    // read below finds nothing is harmless: the transaction returns 404 having written nothing.
    await tx.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, input.leagueId)).for("update");
    const [row] = await tx
      .select({
        draftId: drafts.id,
        status: drafts.status,
        commissionerUserId: leagues.commissionerUserId,
        houseRung: leagues.houseRung,
        startTrigger: drafts.startTrigger,
      })
      .from(drafts)
      .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
      .where(eq(drafts.leagueId, input.leagueId))
      .for("update", { of: drafts });

    if (row === undefined) {
      return { ok: false, status: 404, reason: DRAFT_NOT_FOUND };
    }
    // `withLeagueMemberActor` already refused a stranger before this function was ever called
    // (`PUT /api/leagues/[leagueId]/draft-schedule`), so every caller reaching this point is a
    // genuine member of THIS league. A house league's `!isCommissionerOf` is true for every one
    // of them, with nobody left who could ever see past it — the Task 7 `whenFull` generalization
    // (ruling 32): the platform's own catalog chose this draft's time, so this answers the true
    // reason rather than the ordinary member's 404.
    if (row.houseRung !== null) {
      return { ok: false, status: 409, reason: HOUSE_AUTHORITY_REFUSALS.schedule };
    }
    if (!isCommissionerOf(row, input.userId)) {
      return { ok: false, status: 404, reason: DRAFT_NOT_FOUND };
    }
    if (row.status !== "scheduled") {
      return { ok: false, status: 409, reason: KICKOFF_REFUSALS.alreadyStarted };
    }
    if (row.startTrigger === "when_full") {
      return { ok: false, status: 409, reason: KICKOFF_REFUSALS.whenFull };
    }

    const kickoffMs = Date.parse(input.kickoffAt);
    if (Number.isNaN(kickoffMs)) {
      return { ok: false, status: 422, reason: "That does not look like a valid time." };
    }
    const nowMs = Date.parse(clock.now());
    if (kickoffMs <= nowMs) {
      return { ok: false, status: 422, reason: KICKOFF_REFUSALS.past };
    }
    if (kickoffMs - nowMs > LEAGUE_CONFIG.defaults.maxDraftDaysAhead * MS_PER_DAY) {
      return { ok: false, status: 422, reason: KICKOFF_REFUSALS.tooFar };
    }

    await tx.update(drafts).set({ kickoffAt: new Date(kickoffMs) }).where(eq(drafts.leagueId, input.leagueId));
    return { ok: true, kickoffAt: new Date(kickoffMs).toISOString() };
  });
}
