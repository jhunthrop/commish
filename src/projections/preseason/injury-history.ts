import type { SeasonAvailability } from "./availability";

/**
 * INJURY-HISTORY FEATURES (availability model upgrade, 2026-09-05).
 *
 * Motivated by two converging facts: the season-band backtest under-covers real outcomes
 * (`docs/research/2026-09-04-rookie-calibration-backtest.md` measures 0.61-0.66 against the 0.80 a
 * p10-p90 claims), and Nate Silver's QBERT team published that a comparable model understated weekly
 * injury rates by roughly half — fixed with a simple feature set: PAST INJURIES PREDICT FUTURE ONES,
 * CAREER LONGEVITY IS EVIDENCE OF AVOIDANCE, AGE RAISES RISK, and WORKLOAD RAISES RISK.
 *
 * Age is already `ageAtSeason` in `availability.ts`. The three functions here derive the other
 * ingredients purely from `SeasonAvailability` records a caller has already built from real
 * per-week presence (`player_week_observations`: a player with a stat line played, the schedule
 * says his team played) — nothing here invents history or reads a store. `availability.ts` turns
 * these numbers into brackets and fits a multiplier over each; this module only computes the
 * numbers.
 */

/**
 * Games he missed in one specific season: his team's games minus his, floored at zero — a bye or a
 * game he did not dress for either way, exactly as `SeasonAvailability.gamesPlayed` already counts
 * it. `null` where the history carries no record for that season at all, which is "he was not on a
 * roster that year" (a rookie, a man not yet in the league) rather than "he played every game" — an
 * absent record must never be read as a clean season.
 */
export function gamesMissedInSeason(history: readonly SeasonAvailability[], season: number): number | null {
  const entry = history.find((row) => row.season === season);
  if (entry === undefined) return null;
  return Math.max(0, entry.teamGames - Math.min(entry.gamesPlayed, entry.teamGames));
}

/**
 * PAST INJURIES PREDICT FUTURE ONES: games missed across the two most recent prior seasons,
 * combined. A season absent from the record contributes ZERO rather than a full season's worth of
 * missed games — no record is an absence of evidence, not evidence of a lost year, and treating it
 * as the latter would charge every rookie and every second-year player for seasons that were never
 * his to miss.
 */
export function recentGamesMissed(history: readonly SeasonAvailability[], season: number): number {
  return (gamesMissedInSeason(history, season - 1) ?? 0) + (gamesMissedInSeason(history, season - 2) ?? 0);
}

/**
 * CAREER LONGEVITY IS EVIDENCE OF AVOIDANCE: games played over games his teams played, summed
 * across EVERY season the history carries — not only the seasons `shrunkAvailabilityRate` weighs.
 * A long, largely-complete record is real evidence a body holds up that a three-season window
 * alone would understate; `source.ts` widens the window this function is handed specifically so
 * this number means "career" rather than "recent."
 *
 * `null` with no history at all: a man with no NFL seasons behind him has no career to be durable
 * or fragile in, and that is a different claim than "durable" or "fragile" would each make.
 */
export function careerAvailabilityRate(history: readonly SeasonAvailability[]): number | null {
  if (history.length === 0) return null;
  let played = 0;
  let teamGames = 0;
  for (const row of history) {
    played += Math.min(row.gamesPlayed, row.teamGames);
    teamGames += row.teamGames;
  }
  return teamGames > 0 ? played / teamGames : null;
}

/** How many seasons of real record `careerAvailabilityRate` is measured over — the evidence weight
 *  a fit needs to decide how far to trust it, exactly as `historySeasons` decides it for the
 *  games-played shrinkage itself. */
export function careerSeasonsOfRecord(history: readonly SeasonAvailability[]): number {
  return history.length;
}

/** One prior season's workload: his snap share over the games his team played that season — see
 *  `priorSeasonWorkloadShare`'s own docblock for why a SHARE rather than a raw touch count is the
 *  quantity carried here. */
export interface SeasonWorkload {
  readonly season: number;
  readonly snapShare: number;
}

/**
 * WORKLOAD RAISES RISK: the immediately prior season's snap share, the evidence a manager actually
 * has about how hard a body was used. `null` where the prior season carries no recorded share at
 * all — a rookie with no NFL season behind him, or a man who played no offensive snaps.
 *
 * A SHARE RATHER THAN A RAW TOUCH COUNT, on purpose. Touches (targets, carries, pass attempts) are
 * on wildly different scales by position — a starting quarterback's pass attempts and a rotation
 * running back's carries are not comparable numbers — so bucketing them would need a position-by-
 * position table of magnitude cutoffs this codebase's own discipline treats as an eyeballed
 * constant. Snap share is already the SAME normalised quantity `roleBracketFor` brackets for a
 * player's CURRENT projected role; reusing it here for his PRIOR season's actual role answers a
 * different, complementary question — how hard was he used last year, not how big is his job this
 * year — through boundaries this engine has already measured and documented rather than a new
 * invented scale.
 */
export function priorSeasonWorkloadShare(workload: readonly SeasonWorkload[], season: number): number | null {
  return workload.find((entry) => entry.season === season - 1)?.snapShare ?? null;
}
