/**
 * TASK 7 SEED (Phase 3.6, Task 5, F9), EXTENDED BY TASK 7 ITSELF ("Roll until full"). This
 * module's real owner was always Task 7 — Task 5 authored the first two branches one step early
 * because `OpenLeagueCard` needed the when-full sentence before the roll existed to phrase it
 * (see that commit's own docblock, preserved below). This step is what the seed's own docblock
 * predicted: `describeStartTiming`'s input widens, and `rollNoticeSentence`/`roomIsFull`/
 * `nextKickoffAfter`/`ROLL_REFUSALS` land alongside it.
 *
 * Browser-safe, exactly like `@/matchmaking/config` and `@/matchmaking/filter` — no I/O, no wall
 * clock — so `src/league-room/**` may value-import it despite the client-boundary rule.
 * `LeagueAuthority` (`@/league-service/authority`) is imported TYPE ONLY, the same zero-runtime-
 * cost allowance `WaitingRoomLeague` (`@/league-room/components/waiting-room`) already relies on
 * for the identical type: a type import erases at compile time and costs the client bundle
 * nothing, so borrowing the vocabulary costs nothing either.
 */

import { hasOpenSeat } from "@/matchmaking/filter";
import { ROLL_CADENCE_HOURS } from "@/matchmaking/config";
import { MS_PER_SECOND, SECONDS_PER_HOUR } from "@/domain/duration";
import type { LeagueAuthority } from "@/league-service/authority";

export type StartTrigger = "scheduled" | "when_full";

/**
 * Which of the two ways a league's draft can be started once it fills — a house league has no
 * commissioner to name, a member league does. Derived by every caller from
 * `PublicLeagueSummary.houseRung` (`null` -> `"member"`, otherwise `"house"`) or, for a caller
 * already holding a real `LeagueAuthority` (a signed-in member reading their own league), from
 * its own `kind` — declared as `LeagueAuthority["kind"]` rather than a second hand-written union,
 * so the two vocabularies can never drift apart. Never the full `LeagueAuthority` object: the
 * scheduled/when-full sentences below only ever depend on WHICH kind of authority runs a league,
 * never on WHO — and `PublicLeagueSummary` deliberately never discloses a real commissioner
 * `userId` to a stranger reading a browse card (that contract's own docblock), so a function every
 * browse card calls can never require one either.
 */
export type StartTimingAuthority = LeagueAuthority["kind"];

export interface StartTimingInput {
  readonly startTrigger: StartTrigger;
  readonly authority: StartTimingAuthority;
}

/**
 * F9's own sentence, verbatim, for a still-filling sit-and-go league — the promise and its
 * reassurance, reassurance second, so it reads as relief rather than a caveat. `OpenLeagueCard`
 * and the waiting room quote this string; neither restates it.
 */
const WHEN_FULL_COMMITMENT =
  "This one drafts the moment the last seat is taken. We tell you as soon as it fills, and the room opens a few minutes after that. You do not have to wait here.";

/** F11: a house league has no commissioner who can press a start button early, so its scheduled
 *  commitment names only the fill condition. A member league's commissioner CAN start early
 *  (Task 7 Step 3's short-room warning), so that branch names both ways the draft can start. */
const SCHEDULED_COMMITMENT: Readonly<Record<StartTimingAuthority, string>> = {
  house: "The draft starts as soon as the last seat is taken.",
  member: "The draft starts as soon as the last seat is taken, or when your commissioner starts it.",
};

/**
 * THE ONE FUNCTION every start-timing sentence in this product is quoted from (F9) — never
 * restated. The browse card, the waiting room, the draft-schedule panel and the
 * `draft_kickoff_rolled` notice all call it.
 */
export function describeStartTiming({ startTrigger, authority }: StartTimingInput): string {
  return startTrigger === "when_full" ? WHEN_FULL_COMMITMENT : SCHEDULED_COMMITMENT[authority];
}

/**
 * "The room this draft needs is here" — literally `!hasOpenSeat(...)` (`@/matchmaking/filter`),
 * re-exported by NAME so the reason a scan gates on it is greppable rather than an inlined
 * negation a reader has to double back on. The founder's ruling ("no draft ever fires below a
 * full room") reduces to this one predicate, applied at the two places Task 7's own gate has to
 * agree with itself: `dueDraftsQuery`'s SQL (`@/draft-service/auto-start`, the correlated seat
 * count that decides start-vs-roll in the query's own output) and `rollUnfilledDraftInTx`'s own
 * TypeScript re-derivation (`@/league-service/roll`) immediately before its guarded write — the
 * identical "the query computes it, the code re-checks it" discipline `matchesBrowseFilter`/
 * `browseQuery` already hold each other to over one seeded corpus.
 *
 * Deliberately blind to held seats (`hasOpenSeat`'s own optional second parameter): a hold is a
 * fact about who is mid-CLAIMING a seat, not about how many real teams are seated, and "the room
 * is full" for the purpose of firing a draft has only ever meant real, seated teams.
 */
export function roomIsFull(league: { readonly teamCount: number; readonly filledTeams: number }): boolean {
  return !hasOpenSeat(league);
}

const ROLL_CADENCE_MS = ROLL_CADENCE_HOURS * SECONDS_PER_HOUR * MS_PER_SECOND;

/**
 * The next instant, strictly after `nowIso`, that keeps `kickoffIso`'s own time-of-day —
 * `kickoffIso + n * ROLL_CADENCE_HOURS` for the smallest `n` that lands in the future. A fixpoint
 * over the roll's cadence, the identical shape `deadlineAfter` (`@/draft-engine/pause`) uses to
 * walk a deadline past the overnight pause window: both answer "how far do I have to step a fixed
 * cadence before I land somewhere real", and both keep the human-chosen clock-face time rather
 * than resetting it to the instant the fixpoint happened to run.
 *
 * A process that was down for three days must not roll a draft to yesterday, or to today at a
 * time that has already passed again by the time anyone reads it — this is what keeps a kickoff
 * that has been due for 77 hours landing on the FIRST future slot the cadence offers, not the
 * first slot after the original time, however far in the past that now is.
 */
export function nextKickoffAfter(kickoffIso: string, nowIso: string): string {
  const kickoffMs = Date.parse(kickoffIso);
  const nowMs = Date.parse(nowIso);
  const elapsedMs = Math.max(0, nowMs - kickoffMs);
  const steps = Math.floor(elapsedMs / ROLL_CADENCE_MS) + 1;
  return new Date(kickoffMs + steps * ROLL_CADENCE_MS).toISOString();
}

/**
 * Every reason `rollUnfilledDraftInTx` (`@/league-service/roll`) declines to roll a draft's
 * kickoff, named once so the function and its tests never hand-type a second copy of the same
 * sentence — the identical discipline `FILL_TRIGGER_REFUSALS` and `ROLL_REFUSALS`'s own sibling
 * guards already hold. None of these reach a member directly: the roll, like the fill trigger, has
 * no human caller.
 */
export const ROLL_REFUSALS = {
  /** The draft has already left `'scheduled'` — nothing about a kickoff is left to roll. */
  alreadyStarted: "This draft has already started.",
  /** A `when_full` draft's kickoff only exists after its room fills — there is no chosen time to
   *  roll forward, and no target it could ever be late for before that. */
  notScheduled: "This draft starts when the room fills, so nobody rolls its clock.",
  /** The room is genuinely full — re-derived fresh, immediately before the write, in case a join
   *  landed the last seat between the scan that found this draft and the roll that would have
   *  moved it. A full room's own next stop is the START door, not this one. */
  full: "This league's room is already full; there is nothing to roll.",
  /** Another instance's guarded `UPDATE` already rolled this exact kickoff first — the same
   *  clean, structural no-op `claimAutoStart`'s own guarded status transition reports. */
  raced: "Another instance already rolled this draft's kickoff.",
} as const;

/**
 * "This draft moved once because the room was not full." / "...moved twice..." / "...moved 5
 * times since it was scheduled." (F12) — pluralized honestly, because a room on its fifth roll
 * that still says "moved once" is the product lying about the only fact the member is tracking.
 * The waiting room, the browse card and the `draft_kickoff_rolled` notice all quote this string
 * verbatim; none of them compose their own version of it.
 */
export function rollNoticeSentence(kickoffRolls: number): string {
  const times = kickoffRolls === 1 ? "once" : kickoffRolls === 2 ? "twice" : `${kickoffRolls} times`;
  const tail = kickoffRolls <= 2 ? "" : " since it was scheduled";
  return `This draft moved ${times} because the room was not full${tail}.`;
}
