/**
 * TASK 7 SEED (Phase 3.6, Task 5, F9). This file's real owner is Task 7 ("Roll until full"),
 * which had not landed when Task 5 was implemented — Task 5's `OpenLeagueCard` depends on the
 * exact when-full sentence this module is named as the single authority for, and the plan is
 * explicit that this card "does not phrase the promise… `describeStartTiming`… does" (F9). Rather
 * than hand-write that sentence inline in a component (the exact duplication F9 exists to
 * prevent), this module is created here, one Step early, with ONLY the two branches Task 5
 * actually consumes.
 *
 * Task 7 Step 7 is expected to EXTEND `describeStartTiming`'s input to `{ startTrigger, kickoffAt,
 * kickoffRolls, filledTeams, teamCount, authorityKind }` (the plan's own signature, once
 * `kickoff_rolls` exists) and to add `rollNoticeSentence` alongside it — this seed's job is done
 * the moment that extension lands; nothing here should block it, and nothing here duplicates it.
 *
 * Browser-safe, exactly like `@/matchmaking/config` and `@/matchmaking/filter` — no I/O, no wall
 * clock — so `src/league-room/**` may value-import it despite the client-boundary rule.
 */

export type StartTrigger = "scheduled" | "when_full";

/**
 * Which of the two ways a league's draft can be started once it fills — a house league has no
 * commissioner to name, a member league does. Derived by every caller from
 * `PublicLeagueSummary.houseRung` (`null` → `"member"`, otherwise `"house"`) rather than carried
 * as a third wire field: it is the identical fact `houseRung` already discloses, read a second way.
 */
export type StartTimingAuthority = "house" | "member";

export interface StartTimingInput {
  readonly startTrigger: StartTrigger;
  readonly authorityKind: StartTimingAuthority;
}

/**
 * F9's own sentence, verbatim, for a still-filling sit-and-go league — the promise and its
 * reassurance, reassurance second, so it reads as relief rather than a caveat. `OpenLeagueCard`
 * and (once Task 9 ships) the waiting room quote this string; neither restates it.
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
 * restated. Today it covers the two branches a `PublicLeagueSummary` alone can answer (whether a
 * league is sit-and-go or scheduled, and whether it is house- or member-run); Task 7 Step 7 widens
 * it to also account for `kickoffRolls` once a roll can actually happen.
 */
export function describeStartTiming({ startTrigger, authorityKind }: StartTimingInput): string {
  return startTrigger === "when_full" ? WHEN_FULL_COMMITMENT : SCHEDULED_COMMITMENT[authorityKind];
}
