import { COACH_METRICS } from "../nflverse/coaches";
import { PBP_METRICS } from "../nflverse/pbp";
import type { TeamMetricLookup, WeekRef } from "../team-context";

/**
 * SCHEME AND PACE — the size of the pie every share is drawn from, and what happens to it when the
 * play-caller changes.
 *
 * Layer 1 already predicts team volume, from the team's own realised targets, carries and attempts.
 * The claim this feature makes is that those realised volumes are CONTAMINATED and two cleaner
 * numbers exist. A team that spent three weeks trailing by twenty threw ninety times more than its
 * coordinator wanted to; a team that spent them leading ran the clock out. Situation-neutral pace
 * and pass rate over expected are measured with the game close and outside the two-minute drill,
 * which is the only window in which what an offence does is what it INTENDS to do.
 *
 * THE COACHING CHANGE IS THE WHOLE POINT OF THE SEASON PRIOR. A team's tendencies are its
 * play-caller's tendencies, so when he leaves, last season stops being evidence about this one. The
 * prior therefore switches: a returning coach's team regresses toward its own last season, and a
 * new coach's team regresses toward HIS last season somewhere else. A coach with no history we can
 * see regresses to the league, which is the honest answer for a first-time head coach rather than a
 * pretence that the team he is replacing tells us anything.
 *
 * Pure, like every other feature module: it takes a lookup and returns numbers, so it runs inside
 * an ablation loop and needs no database.
 */

export const SCHEME_CONFIG = {
  /**
   * How many games of season prior this season's neutral measurements are shrunk toward.
   *
   * Three, and lower than the line composite's four, because a scheme is a decision rather than a
   * physical property: a coordinator who has thrown on 62% of neutral downs for three weeks has
   * told you what he intends, where three weeks of good blocking might be three good opponents.
   */
  shrinkageGames: 3,
  /**
   * How many games of evidence the SEASON prior is itself worth against the league.
   *
   * A full prior season is seventeen games and would swamp anything this season could say if it
   * were counted at face value. Six is enough to carry a genuine identity into September and light
   * enough that a real change is visible by October.
   */
  priorSeasonGames: 6,
} as const;

/** One offence's intent, as it stood before the week being predicted. `null` where unknown. */
export interface SchemeEstimate {
  /** Situation-neutral seconds per play. LOWER is faster, which is the sign to keep straight. */
  readonly paceSecondsPerPlay: number | null;
  /** Situation-neutral share of plays that were passes. */
  readonly passRate: number | null;
  /** Pass rate minus what the down, distance and score suggested, in percentage points. */
  readonly passRateOverExpected: number | null;
  /** True when this season's play-caller did not have this team last season. */
  readonly coachingChange: boolean;
}

/** The league means every scheme ratio is taken against, measured on the fit seasons. */
export interface SchemeLeagueMeans {
  readonly paceSecondsPerPlay: number;
  readonly passRate: number;
  readonly passRateOverExpected: number;
}

export interface SchemeInput {
  readonly team: string;
  readonly season: number;
  /** The week being predicted. Nothing at or after it is read. */
  readonly week: number;
  readonly metrics: TeamMetricLookup;
  readonly league: SchemeLeagueMeans;
  /** How many weeks a prior season can have, for the prior-season mean. */
  readonly lastPossibleWeek: number;
}

function meanOver(weeks: readonly WeekRef[], read: (at: WeekRef) => number | null): { mean: number | null; games: number } {
  let sum = 0;
  let games = 0;
  for (const at of weeks) {
    const value = read(at);
    if (value === null) continue;
    sum += value;
    games += 1;
  }
  return { mean: games === 0 ? null : sum / games, games };
}

function shrink(estimate: number | null, games: number, prior: number, k: number): number {
  if (estimate === null || games <= 0) return prior;
  return (games * estimate + k * prior) / (games + k);
}

/**
 * One offence's scheme, through two shrinkage levels, with the coaching change deciding what the
 * upper level is.
 *
 * The shape deliberately mirrors layer 1's own two-level shrinkage — season prior, then this
 * season's form shrunk toward it — because it is answering the same question about a different
 * quantity, and two different shapes for one idea is how a model becomes undebuggable.
 */
export function schemeEstimate({ team, season, week, metrics, league, lastPossibleWeek }: SchemeInput): SchemeEstimate {
  const thisSeason = Array.from({ length: Math.max(0, week - 1) }, (_, index) => ({ season, week: index + 1 }));
  const priorSeason = Array.from({ length: lastPossibleWeek }, (_, index) => ({ season: season - 1, week: index + 1 }));

  // Tenure is stamped at schedule publication, so it is knowable in week 1 — which is exactly the
  // week a coaching change matters most and the only week no in-season evidence exists at all.
  const tenure = metrics(team, { season, week }, COACH_METRICS.tenureSeasons);
  const coachingChange = tenure !== null && tenure === 0;

  const level = (metric: string, coachMetric: string | null, leagueMean: number): number | null => {
    const own = meanOver(priorSeason, (at) => metrics(team, at, metric));
    const coachPrior = coachMetric === null ? null : metrics(team, { season, week }, coachMetric);
    // A new play-caller replaces the team's own history with his, and falls back to the league when
    // we have none of his. A returning one keeps the team's.
    const seasonPrior = coachingChange
      ? (coachPrior ?? leagueMean)
      : shrink(own.mean, own.games, leagueMean, SCHEME_CONFIG.priorSeasonGames);
    const form = meanOver(thisSeason, (at) => metrics(team, at, metric));
    if (form.mean === null && own.mean === null && coachPrior === null) return null;
    return shrink(form.mean, form.games, seasonPrior, SCHEME_CONFIG.shrinkageGames);
  };

  return {
    paceSecondsPerPlay: level(PBP_METRICS.paceSecondsPerPlay, COACH_METRICS.priorPace, league.paceSecondsPerPlay),
    passRate: level(PBP_METRICS.passRate, null, league.passRate),
    passRateOverExpected: level(
      PBP_METRICS.passRateOverExpected,
      COACH_METRICS.priorPassRateOverExpected,
      league.passRateOverExpected,
    ),
    coachingChange,
  };
}

/** What the scheme says about an offence's volume, relative to the league. 1 is average. */
export interface SchemeRatios {
  /** Above 1 when this offence runs MORE plays than average — so pace inverted, since it is seconds. */
  readonly tempo: number | null;
  /** Above 1 when this offence passes more often than average. */
  readonly passLean: number | null;
}

/**
 * The two ratios the volume multipliers are powers of.
 *
 * Pace is INVERTED here and nowhere else, which is the single easiest sign error available in this
 * feature: pace is measured in seconds per play, so a fast offence has a LOW number and a high
 * tempo. Doing it once, here, is why every consumer can read `tempo > 1` as "faster".
 */
export function schemeRatios(estimate: SchemeEstimate, league: SchemeLeagueMeans): SchemeRatios {
  return {
    tempo:
      estimate.paceSecondsPerPlay === null || estimate.paceSecondsPerPlay <= 0
        ? null
        : league.paceSecondsPerPlay / estimate.paceSecondsPerPlay,
    passLean: estimate.passRate === null || league.passRate <= 0 ? null : estimate.passRate / league.passRate,
  };
}
