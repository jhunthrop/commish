import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { draftActions, draftSlotPreferences, drafts, leagues, teams } from "@/db/schema";
import type { DraftStatus } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import { draftActionSchema } from "@/draft-engine";
import { LEAGUE_CONFIG } from "@/league";
import type { DraftScheduleBody, SlotPreferenceView } from "@/league-room/contract";
import { MS_PER_DAY } from "./config";

/** The outermost edge is the only place a wall clock is allowed — see every other service
 *  module's identical constant (`creation.ts`, `invites.ts`, `lineups.ts`, ...). */
const systemClock: Clock = { now: () => new Date().toISOString() };

/** Answered when the league or its draft can't be found, AND when the caller is a real member
 *  of a real league but not its commissioner — the same 404, for the same non-oracle reason
 *  `publicJoinPrecondition` and `withAdmin` already answer 404 rather than 403 (ruling 14): a
 *  caller who is not allowed to act on this draft learns nothing about whether a different
 *  draft exists that they also can't act on. */
const DRAFT_NOT_FOUND = "That draft doesn't exist.";

/**
 * The three refusals `setDraftKickoff` can give for an otherwise-authorized request, named once
 * so the service and its tests never hand-type a second copy of the same sentence.
 */
export const KICKOFF_REFUSALS = {
  alreadyStarted: "This draft has already started, so its time can't change.",
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
  readonly commissionerUserId: string;
  readonly isPublicMatchmade: boolean;
  /** Task 6: how many draft slots this league has — the ranking ceiling. */
  readonly teamCount: number;
  /** Phase 3.5, Task 8: which of the two ways this draft's `kickoffAt` comes to be set. */
  readonly startTrigger: "scheduled" | "when_full";
}

/** One league's draft row, joined to the one fact about its league every caller here needs:
 *  who commissions it. `drafts_league_id_idx` (`@/db/schema`) makes this a unique lookup. */
async function draftRowForLeague(db: Db, leagueId: string): Promise<DraftRow | undefined> {
  const [row] = await db
    .select({
      draftId: drafts.id,
      status: drafts.status,
      kickoffAt: drafts.kickoffAt,
      commissionerUserId: leagues.commissionerUserId,
      isPublicMatchmade: leagues.isPublicMatchmade,
      teamCount: leagues.teamCount,
      startTrigger: drafts.startTrigger,
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
  return {
    draftId: row.draftId,
    leagueId,
    status: row.status,
    kickoffAt: row.kickoffAt.toISOString(),
    isPublicMatchmade: row.isPublicMatchmade,
    startTrigger: row.startTrigger,
    filledTeams: teamRows.length,
    slotPreference: await slotPreferenceViewFor(db, {
      draftId: row.draftId,
      status: row.status,
      teamId: myTeam?.id ?? null,
      slotCount: row.teamCount,
    }),
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
 * Locks the draft row `FOR UPDATE` before checking anything, so two concurrent reschedules (or
 * a reschedule racing `startDraft`) resolve one at a time rather than both reading `scheduled`
 * and both deciding they may proceed. PROVEN, not promised (final review F10 — this docblock
 * asserted the property and nothing measured it): `src/integrity-service/lock-order.test.ts`'s
 * "setDraftKickoff's row lock" drives both races on two real connections, including the half the
 * call site does not read — the `.for("update")` spans the `innerJoin`, so it locks the `leagues`
 * row as well as the `drafts` one. NO-WRITE-BEFORE-REFUSAL holds here exactly as it does at
 * `createLeague`'s own gate: every refusal branch below returns before the `UPDATE` statement is
 * ever reached, so a refused reschedule commits nothing but the row lock it already had to take
 * to ask the question safely.
 */
export async function setDraftKickoff(
  db: Db,
  input: SetDraftKickoffInput,
  clock: Clock = systemClock,
): Promise<SetDraftKickoffResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        draftId: drafts.id,
        status: drafts.status,
        commissionerUserId: leagues.commissionerUserId,
        startTrigger: drafts.startTrigger,
      })
      .from(drafts)
      .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
      .where(eq(drafts.leagueId, input.leagueId))
      .for("update");

    if (row === undefined || row.commissionerUserId !== input.userId) {
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
      return { ok: false, status: 422, reason: "That doesn't look like a valid time." };
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
