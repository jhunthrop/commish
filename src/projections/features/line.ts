import { CONTINUITY_METRICS } from "../nflverse/team-map";
import { PBP_METRICS } from "../nflverse/pbp";
import type { TeamMetricLookup, WeekRef } from "../team-context";

/**
 * THE OFFENSIVE LINE COMPOSITE — ours, derived from free data, never licensed at runtime.
 *
 * The founder ruled on 2026-08-27 that PFF grades are development-time calibration only: a product
 * whose draft-week projections depend on a live scrape of somebody else's paywall is a product with
 * a failure mode nobody can fix on a Saturday. So the four components are ones we can compute
 * ourselves, and each answers a different question about the same five men:
 *
 *   - ADJUSTED LINE YARDS — how much of a carry's yardage belongs to the blocking rather than to
 *     the back, by the conventional yardage bands. This is the run-blocking measurement.
 *   - STUFFED RATE — how often a carry died at or behind the line. The same question at the
 *     extreme, and it moves for reasons adjusted line yards does not: a line can be adequate on
 *     average and catastrophic on first contact.
 *   - SACK RATE ALLOWED — pass protection, with the honest caveat that it is partly the
 *     quarterback's own: a slow processor takes sacks behind a good line.
 *   - CONTINUITY — how often the same five have started. It is used differently from the other
 *     three and that is the interesting part of this file: see `lineConfidence`.
 *
 * WHY CONTINUITY IS A CONFIDENCE AND NOT A COMPONENT. A line that has started a different five
 * every week is not necessarily a BAD line; it is an UNKNOWN one, and the three rates measured on
 * it describe men who may not play this week. Treating instability as badness would penalise a good
 * line with an injured guard twice — once through the worse rates it actually posted, and again
 * through a continuity penalty. Treating it as uncertainty instead does the right thing in one
 * step: an unsettled line's composite is pulled back toward league average, which is precisely what
 * we know about it.
 *
 * Everything here is pure and takes its numbers through a lookup, so it runs inside an ablation
 * loop. NULL IS NOT ZERO throughout: a team with no line rows has no composite, and a caller must
 * fall back to the model without one rather than assume the worst line in the league.
 */

/** Every tunable the composite has, so a reviewer can find them all in one place. */
export const LINE_CONFIG = {
  /**
   * How many team-weeks of league prior each rate is shrunk toward, in games.
   *
   * Four is roughly a quarter of a season. Below that a single game against a bad front reads as a
   * new line; far above it and a genuine mid-season change (a tackle returns, a guard is benched)
   * never reaches the projection at all. The value is stated rather than searched because the
   * elasticities that consume it ARE fitted, and two knobs fitted against the same small signal
   * fight each other.
   */
  shrinkageGames: 4,
  /** Five men start. Continuity is reported as how many of them carried over. */
  lineStarters: 5,
  /**
   * How far a fully-settled line is allowed to move the composite, as a multiple of the raw ratio.
   *
   * One means "a settled line's measured ratio is used as measured". An unsettled line's is damped
   * toward one in proportion to how much of it changed — see `lineConfidence`.
   */
  settledWeight: 1,
  /**
   * The floor on that damping. Even a line that changed all five starters is not evidence-free: the
   * scheme, the coaching and the four other men on the field persist. Zero would say otherwise.
   */
  minimumWeight: 0.35,
} as const;

/** One team's line, as it stood before the week being predicted. `null` where nothing is known. */
export interface LineComposite {
  /** Run blocking, as a ratio to the league: above 1 is better than average. */
  readonly runBlocking: number | null;
  /** Pass protection, as a ratio to the league: above 1 is better than average (fewer sacks). */
  readonly passProtection: number | null;
  /** How much of the raw ratio is being trusted, from continuity. 1 is a settled line. */
  readonly confidence: number;
}

/** A recency-free mean over the weeks a lookup carries, and the count it rests on. */
function meanOver(
  weeks: readonly WeekRef[],
  read: (at: WeekRef) => number | null,
): { readonly mean: number | null; readonly games: number } {
  let sum = 0;
  let games = 0;
  for (const week of weeks) {
    const value = read(week);
    if (value === null) continue;
    sum += value;
    games += 1;
  }
  return { mean: games === 0 ? null : sum / games, games };
}

/** One shrinkage step toward a league value, counted in games. Mirrors layer 1's own `shrink`. */
function towardLeague(estimate: number | null, games: number, league: number, k: number): number | null {
  if (estimate === null || games <= 0) return null;
  return (games * estimate + k * league) / (games + k);
}

/**
 * How much of a line's measured ratio to believe, from how often the same five have started.
 *
 * A line whose five carried over intact every week gets its measurement at face value; one that has
 * changed a man a week is damped toward the league, because the rates it posted were posted by
 * people who may not be playing. The floor stops a wholesale reshuffle from erasing everything the
 * offence is — see the module docblock.
 */
export function lineConfidence(sameStarters: number | null): number {
  if (sameStarters === null) return LINE_CONFIG.minimumWeight;
  const carried = Math.min(LINE_CONFIG.lineStarters, Math.max(0, sameStarters)) / LINE_CONFIG.lineStarters;
  return LINE_CONFIG.minimumWeight + (LINE_CONFIG.settledWeight - LINE_CONFIG.minimumWeight) * carried;
}

/** The league means the ratios are taken against, measured on the fit seasons. */
export interface LineLeagueMeans {
  readonly adjustedLineYards: number;
  readonly stuffedRate: number;
  readonly sackRateAllowed: number;
}

export interface LineCompositeInput {
  readonly team: string;
  /** The weeks a prediction may read — from `contextWindow`, never including the target week. */
  readonly weeks: readonly WeekRef[];
  readonly metrics: TeamMetricLookup;
  readonly league: LineLeagueMeans;
}

/**
 * One team's composite, from the weeks a prediction is allowed to see.
 *
 * Run blocking folds adjusted line yards and stuffed rate together rather than reporting them
 * separately, because they are two readings of one thing and a consumer given both would have to
 * decide how to weigh them — which is a decision that belongs here, next to the reason for it. The
 * stuffed rate enters INVERTED (league over team) so that both halves point the same way, which is
 * the single easiest thing to get backwards in this file.
 */
export function lineComposite({ team, weeks, metrics, league }: LineCompositeInput): LineComposite {
  const read = (metric: string) => (at: WeekRef) => metrics(team, at, metric);
  const lineYards = meanOver(weeks, read(PBP_METRICS.adjustedLineYards));
  const stuffed = meanOver(weeks, read(PBP_METRICS.stuffedRate));
  const sacks = meanOver(weeks, read(PBP_METRICS.sackRateAllowed));
  const continuity = meanOver(weeks, read(CONTINUITY_METRICS.sameStarters));
  const confidence = lineConfidence(continuity.mean);

  const k = LINE_CONFIG.shrinkageGames;
  const shrunkLineYards = towardLeague(lineYards.mean, lineYards.games, league.adjustedLineYards, k);
  const shrunkStuffed = towardLeague(stuffed.mean, stuffed.games, league.stuffedRate, k);
  const shrunkSacks = towardLeague(sacks.mean, sacks.games, league.sackRateAllowed, k);

  /** A ratio damped toward 1 by the confidence — the one place continuity is applied. */
  const damped = (ratio: number | null): number | null => (ratio === null ? null : 1 + (ratio - 1) * confidence);

  const yardsRatio = shrunkLineYards === null ? null : shrunkLineYards / league.adjustedLineYards;
  // Inverted on purpose: a LOW stuffed rate is a GOOD line, and both halves of the run-blocking
  // number have to point the same way before they can be averaged.
  const stuffedRatio = shrunkStuffed === null || shrunkStuffed <= 0 ? null : league.stuffedRate / shrunkStuffed;
  const runHalves = [yardsRatio, stuffedRatio].filter((ratio): ratio is number => ratio !== null);
  const runBlocking =
    runHalves.length === 0 ? null : damped(runHalves.reduce((sum, ratio) => sum + ratio, 0) / runHalves.length);

  const passProtection =
    shrunkSacks === null || shrunkSacks <= 0 ? null : damped(league.sackRateAllowed / shrunkSacks);

  return { runBlocking, passProtection, confidence };
}
