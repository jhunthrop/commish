import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { drafts, leagues } from "@/db/schema";
import type { DraftStatus } from "@/domain/draft";
import type { Clock } from "@/domain/timing";
import { LEAGUE_CONFIG } from "@/league";
import type { DraftScheduleBody } from "@/league-room/contract";
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
    })
    .from(drafts)
    .innerJoin(leagues, eq(leagues.id, drafts.leagueId))
    .where(eq(drafts.leagueId, leagueId));
  return row;
}

/**
 * What every league member reads: the chosen time, the draft's state, and whether the platform
 * has a fallback (Task 7). Null for a league that doesn't exist — the route answers 404, the
 * same shape every other league read in this service uses for a missing league.
 */
export async function draftScheduleView(db: Db, leagueId: string): Promise<DraftScheduleBody | null> {
  const row = await draftRowForLeague(db, leagueId);
  if (row === undefined) return null;
  return {
    draftId: row.draftId,
    leagueId,
    status: row.status,
    kickoffAt: row.kickoffAt.toISOString(),
    isPublicMatchmade: row.isPublicMatchmade,
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
