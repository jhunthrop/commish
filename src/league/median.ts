import { roundPoints } from "@/scoring";

export type MedianResult = "win" | "loss" | "tie";

/**
 * The middle score among every team that actually played this week — never the whole roster
 * (a bye team has no score, so it contributes nothing here, and plays no median game of its
 * own), and never a team's own opponent.
 *
 * Even team count: the average of the two middle scores, rounded on the SAME rule `roundPoints`
 * applies to every other score this codebase writes — a median is never a haircut more precise
 * than the numbers it was computed from. Odd team count: the single middle score, already one
 * of the scores in the list, so it needs no further rounding. No scores at all — nobody played
 * this week — has no median, never a fabricated zero.
 */
export function leagueMedian(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  const sorted = [...scores].sort((a, b) => a - b);
  const half = sorted.length / 2;
  if (Number.isInteger(half)) {
    return roundPoints((sorted[half - 1]! + sorted[half]!) / 2);
  }
  return sorted[Math.floor(half)]!;
}

/**
 * One team's own result against the week's median: strictly above wins, strictly below loses,
 * and a score sitting EXACTLY at the median ties — in both directions, the same three-way split
 * every head-to-head matchup already gets.
 */
export function medianResultFor(score: number, median: number): MedianResult {
  if (score > median) return "win";
  if (score < median) return "loss";
  return "tie";
}
