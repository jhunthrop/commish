import type { PublicLeagueSummary } from "./contract";

/**
 * THE SHELF'S ONE SORT SENTENCE (front door blueprint, 2026-09-02): "Sorted by soonest draft
 * you can still join." This module is that sentence as a pure comparator, browser-safe like the
 * rest of `src/matchmaking/**` — no I/O, no ambient clock (`Date.parse` of a parameter is the
 * only date arithmetic, and it reads nothing but its argument).
 *
 * WHY SEATS REMAINING LEADS, for BOTH triggers. A `when_full` room fires the moment its last
 * seat fills (`fireWhenFullInTx`), so its seats-remaining count IS its countdown. A `scheduled`
 * room's chosen kickoff is only a lower bound: an unfilled scheduled room ROLLS forward a day
 * at a time until it fills (the founder's "roll until full" ruling, `rollUnfilledDraftInTx`),
 * so proximity-to-full is the honest predictor of "the draft you can still join" there too. A
 * chosen kickoff therefore breaks TIES — at equal seats remaining the room with the sooner
 * chosen instant drafts first, and a chosen instant beats none — it never outranks a room that
 * is genuinely closer to firing.
 */
function seatsRemaining(league: PublicLeagueSummary): number {
  return league.teamCount - league.filledTeams;
}

/**
 * A `scheduled` league's chosen kickoff in ms, or `Infinity` for `when_full` (whose stored
 * instant is a placeholder nobody chose — `PublicLeagueSummary.startTrigger`'s own docblock)
 * and for a summary that carries no instant at all.
 */
function chosenKickoffMs(league: PublicLeagueSummary): number {
  if (league.startTrigger !== "scheduled" || league.draftAtIso === undefined) return Infinity;
  const ms = Date.parse(league.draftAtIso);
  return Number.isNaN(ms) ? Infinity : ms;
}

/** The comparator: seats remaining ascending, chosen kickoff ascending as the tiebreak, input
 *  order (a stable sort's own guarantee) as the final one. */
export function soonestJoinableOrder(a: PublicLeagueSummary, b: PublicLeagueSummary): number {
  const bySeats = seatsRemaining(a) - seatsRemaining(b);
  if (bySeats !== 0) return bySeats;
  const aKick = chosenKickoffMs(a);
  const bKick = chosenKickoffMs(b);
  if (aKick === bKick) return 0;
  if (aKick === Infinity) return 1;
  if (bKick === Infinity) return -1;
  return aKick - bKick;
}

/** A NEW array in soonest-joinable order — never a mutation of the caller's list. */
export function sortBySoonestJoinableDraft(leagues: readonly PublicLeagueSummary[]): readonly PublicLeagueSummary[] {
  return [...leagues].sort(soonestJoinableOrder);
}
