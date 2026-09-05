/**
 * THE MAKE-IT-BACK ODDS LOOP — Draft HQ's answer to "will he still be there at my next pick?".
 * Aggregates many seeded `continueDraft` (Task 1) continuations from the SAME live-room state:
 * each run replays the room forward with the real bot brain until the asking seat is back on the
 * clock (or the draft ends), and this module tallies, per shortlist player, the fraction of runs
 * where he survived to that next turn.
 *
 * `excludeFromAskingSeat` for every run is `new Set(shortlistIds)` (ruling R-3) — the asking seat
 * can never accidentally answer its own question by taking one of the very players the odds are
 * being measured for. `continueDraft`'s docblock states the exclusion-set invariant this relies
 * on: every excluded id must already be UNDRAFTED, or the bot brain's run-reaction counts would be
 * silently distorted. `shortlistIds` is undrafted by definition (a shortlist is drawn from the
 * board), so no runtime scan is added here — see `continue.ts`'s docblock for the full reasoning.
 *
 * `draftEnded` is a property of the RUN, not of any one player — one `continueDraft` call answers
 * the question for every shortlist id at once, so only a single non-ended-run counter is needed,
 * shared by every output row.
 */
import type { DraftState } from "@/draft-engine";
import { continueDraft } from "./continue";

/** Measured cheap: a continuation is under two rounds of picks (Task 2 plan). */
export const MAKE_IT_BACK_RUNS = 200;

export interface MakeItBackInput {
  readonly state: DraftState;
  readonly askingTeamId: string;
  readonly shortlistIds: readonly string[];
  readonly seed: number;
  readonly runs?: number; // default MAKE_IT_BACK_RUNS
}

export interface MakeItBackOdds {
  readonly playerId: string;
  /** Fraction of runs where he was still undrafted at your next turn — null when the draft ends first. */
  readonly survival: number | null;
  readonly runs: number;
}

/** One seeded continuation's contribution: for each shortlist id, whether it was still undrafted
 *  when the asking seat came back on the clock — undefined (never counted) when the draft ended
 *  first, the one case this run contributes nothing to the tally. */
function runSurvivalFlags(state: DraftState, askingTeamId: string, shortlistIds: readonly string[], exclude: ReadonlySet<string>, seed: number): ReadonlyMap<string, boolean> | null {
  const result = continueDraft({ state, askingTeamId, excludeFromAskingSeat: exclude, seed });
  if (result.draftEnded) return null;
  return new Map(shortlistIds.map((id) => [id, result.undrafted.has(id)]));
}

/**
 * Runs `input.runs ?? MAKE_IT_BACK_RUNS` seeded continuations of `input.state` (seeds
 * `input.seed + runIndex`) and reports, per shortlist player in `shortlistIds` order, the
 * fraction of non-ended runs where he survived to the asking seat's next turn.
 */
export function makeItBackOdds(input: MakeItBackInput): readonly MakeItBackOdds[] {
  const { state, askingTeamId, shortlistIds, seed } = input;
  const runs = input.runs ?? MAKE_IT_BACK_RUNS;
  const exclude: ReadonlySet<string> = new Set(shortlistIds);

  const survivalCounts = new Map<string, number>(shortlistIds.map((id) => [id, 0]));
  let nonEndedRuns = 0;

  for (let runIndex = 0; runIndex < runs; runIndex++) {
    const flags = runSurvivalFlags(state, askingTeamId, shortlistIds, exclude, seed + runIndex);
    if (flags === null) continue;
    nonEndedRuns++;
    for (const id of shortlistIds) {
      if (flags.get(id) === true) survivalCounts.set(id, survivalCounts.get(id)! + 1);
    }
  }

  return shortlistIds.map((id) => ({
    playerId: id,
    survival: nonEndedRuns === 0 ? null : survivalCounts.get(id)! / nonEndedRuns,
    runs: nonEndedRuns,
  }));
}
