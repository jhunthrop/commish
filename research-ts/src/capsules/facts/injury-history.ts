import type { InjuryCapture } from "./harvest-captures";
import type { PlayerFactsInjuryDesignation } from "./types";

/**
 * THIS SEASON'S DESIGNATIONS, AS A DATED HISTORY (spec §4, fact 3; inventory row 3).
 *
 * Pure: `harvest-captures.ts` reads and parses the snapshots, this collapses them. A RUN of the
 * same designation across consecutive captures becomes ONE entry carrying its first and last
 * capture instant and how many captures held it, which is what turns "questionable" into
 * "questionable across four straight captures, from 25 August to 15 September" — a counted, dated
 * fact rather than four identical lines.
 *
 * A CAPTURE THAT DOES NOT NAME HIM ENDS THE RUN, and starts nothing. The feed publishes only the
 * players carrying a designation, so his absence from a snapshot is the feed saying he had none
 * that day. That is a real transition and the next designation is a new entry, never a continuation
 * of the one before it.
 *
 * THE BODY PART IS THE FEED'S OWN AND IS NEVER INFERRED. Only one of the two feeds carries a
 * description at all, so a run's description is the first non-null one any capture in that run
 * published, and `null` when none did. It is never guessed from the designation, never carried
 * across a designation change, and never upgraded to a diagnosis the source did not print.
 */

/** Collapses one player's captures into his run history, oldest run first. */
export function injuryHistoryFor(playerId: string, captures: readonly InjuryCapture[]): readonly PlayerFactsInjuryDesignation[] {
  const runs: PlayerFactsInjuryDesignation[] = [];
  let open: PlayerFactsInjuryDesignation | null = null;

  for (const capture of captures) {
    const seen = capture.designations.get(playerId);
    if (seen === undefined) {
      open = null;
      continue;
    }
    const day = capture.capturedAt.toISOString().slice(0, 10);
    if (open !== null && open.designation === seen.designation) {
      const extended: PlayerFactsInjuryDesignation = {
        ...open,
        description: open.description ?? seen.description,
        lastSeenAt: day,
        captureCount: open.captureCount + 1,
      };
      runs[runs.length - 1] = extended;
      open = extended;
      continue;
    }
    open = { designation: seen.designation, description: seen.description, firstSeenAt: day, lastSeenAt: day, captureCount: 1 };
    runs.push(open);
  }
  return runs;
}
