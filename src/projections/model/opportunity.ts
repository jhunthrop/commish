import type { Position } from "@/domain/player";
import { rollingOpportunity, rollingWeight, type WeeklyValue } from "../features/opportunity";
import { LAST_POSSIBLE_WEEK } from "../store";
import type { PlayerWeekUsage } from "../usage";

/**
 * LAYER 1: THE OPPORTUNITY MODEL — the keystone, and the first thing in this engine that can be
 * wrong.
 *
 * It predicts SHARES, never counts: what fraction of his offence's snaps, targets, carries and
 * throws a player takes. Volume predicts fantasy points far better than efficiency because
 * opportunity is stable and efficiency is mostly noise — a receiver's catch rate swings wildly week
 * to week while his target share barely moves — so the share is the part of the problem that can
 * actually be predicted. It is also the quantity a trade resolves against, which a count cannot
 * express.
 *
 * THE SHAPE IS A TWO-LEVEL SHRINKAGE, and it is deliberately the simplest thing that can work:
 *
 *   role prior  ←  the position's mean, read through the depth chart
 *   prior-season mean, shrunk toward the role prior
 *   this season's recency-weighted mean, shrunk toward that
 *
 * A single decaying average cannot do this job. At any decay that makes last week matter, a week
 * eighteen weeks back is worth nothing — so a week-1 prediction would be pure role prior and would
 * lose badly to "what he did last year", which is the floor. Two levels give the honest answer at
 * both ends: last season's evidence in September, this season's by November. That is also the
 * specific shape of the win available, because the naive floor decays 0.679 → 0.436 through a
 * season for exactly the opposite reason — it never stops reading January.
 *
 * THE ROLE PRIOR IS THE DEPTH CHART, read through snap share. We have no historical depth charts
 * (Tank01 publishes a current snapshot with no history), but snap share IS the depth chart made
 * numeric: a 90%-snap receiver is a number one and a 25%-snap receiver is not, and their expected
 * target shares differ accordingly. So the prior for every other share is a per-position slope
 * against the PREDICTED snap share, which means a player with no history at all still gets a
 * role-shaped answer instead of a league average.
 *
 * Everything here is pure. No I/O, no dates, no league state — these run inside an ablation loop
 * thousands of times, and every parameter arrives as `OpportunityPriors`, fitted elsewhere on
 * seasons held out from any evaluation.
 */

/** What one position's replacement-level player looks like, per unit of snap share. */
export interface RolePrior {
  /** The share of his offence's snaps a player of this position takes, knowing nothing else. */
  readonly snapShare: number;
  /** Target share per unit of snap share — the slope that turns a role into an expected share. */
  readonly targetsPerSnap: number;
  readonly carriesPerSnap: number;
  readonly passAttemptsPerSnap: number;
}

/**
 * Shrinkage constants, in GAMES of evidence: the number of games a prior is worth. `season = 4`
 * means a player's prior-season mean has to beat four games' worth of role prior before it moves
 * the answer much.
 */
export interface OpportunityShrinkage {
  /** How hard a player's prior-season mean is pulled toward his role. */
  readonly season: number;
  /** How hard this season's form is pulled toward the prior-season estimate. */
  readonly inSeason: number;
  /** How hard a team's observed volume is pulled toward the league's. */
  readonly teamVolume: number;
}

export interface OpportunityPriors {
  /** Weight multiplier per week into the past. Fitted, never guessed — see `fit.ts`. */
  readonly recencyDecay: number;
  readonly byPosition: Readonly<Record<Position, RolePrior>>;
  readonly shrinkage: OpportunityShrinkage;
  /** League mean team volume per game — what a team with no record of its own is assumed to run. */
  readonly leagueTeamVolume: { readonly targets: number; readonly carries: number; readonly passAttempts: number };
  /**
   * PER-POSITION OVERRIDES of `shrinkage.season`/`shrinkage.inSeason`, for the SHARE predictions only
   * — never `teamVolume`, which is a team-level quantity no one position's shrinkage should move.
   *
   * `shrinkage` above is one grid search shared by every position, chosen to minimise the POOLED
   * error across all four of them; a position whose own error surface has a different minimum is
   * masked by that pooling, which is exactly the mechanism the starter-band diagnosis pointed at for
   * WR and TE (`docs/research/2026-08-31-prediction-laws-closeout.md`). A position absent here falls
   * back to `shrinkage` unchanged. See `fit.ts`'s `fitShareShrinkageForPosition` and `fitted.ts`'s
   * provenance docblock for the fit window and the acceptance decision each entry recorded.
   */
  readonly shareShrinkageByPosition?: Readonly<Partial<Record<Position, Pick<OpportunityShrinkage, "season" | "inSeason">>>>;
}

/** `priors.shrinkage`, overridden per position where `shareShrinkageByPosition` names one. */
function shareShrinkageFor(priors: OpportunityPriors, position: Position): OpportunityShrinkage {
  const override = priors.shareShrinkageByPosition?.[position];
  return override === undefined ? priors.shrinkage : { ...priors.shrinkage, ...override };
}

/**
 * A decay small enough that only the most recent week counts, but still inside `(0, 1]`.
 *
 * At 0.01 the week before last carries a hundredth of the weight of last week, which rounds to
 * nothing beside it. Zero would be the honest spelling and is rejected on purpose by
 * `rollingOpportunity`: at exactly zero every past week vanishes and a "window" stops meaning
 * anything, so the guard there stands and this constant sits just inside it.
 */
const LAST_WEEK_ONLY_DECAY = 0.01;

/**
 * THE LAYER-1 FLOOR: "he will do what he did last week", with no shrinkage at all.
 *
 * The opportunity model has to beat this before anything above it can be worth reviewing, exactly
 * as the whole engine has to beat prior-season points per game. Expressing it as a POINT IN THE
 * SAME PARAMETER SPACE rather than as a second predictor is deliberate — it is then scored by
 * literally the same code path, so a difference between the two is a difference in the parameters
 * and can be nothing else.
 *
 * With no shrinkage the chain collapses cleanly at every level: a player with in-season weeks gets
 * his last one, a player with none gets his prior-season mean, and a player with neither gets his
 * role prior. That is the best a memoryless predictor can do, and it is the thing to beat.
 */
export function lastObservedPriors(priors: OpportunityPriors): OpportunityPriors {
  // `shareShrinkageByPosition` is cleared too, not just `shrinkage` — left in place it would let a
  // WR/TE override reintroduce shrinkage into what is supposed to be the zero-shrinkage floor.
  return {
    ...priors,
    recencyDecay: LAST_WEEK_ONLY_DECAY,
    shrinkage: { season: 0, inSeason: 0, teamVolume: 0 },
    shareShrinkageByPosition: undefined,
  };
}

/** One player's predicted opportunity for one week. Shares, plus the volume they are taken over. */
export interface PredictedOpportunity {
  readonly playerId: string;
  readonly snapShare: number;
  readonly targetShare: number;
  readonly carryShare: number;
  readonly passAttemptShare: number;
  readonly teamTargets: number;
  readonly teamCarries: number;
  readonly teamPassAttempts: number;
}

export interface OpportunityContext {
  readonly season: number;
  /** The week being predicted. Nothing at or after it is evidence — see `rollingOpportunity`. */
  readonly week: number;
  /** From `nfl_players`. A player whose position does not narrow has no role to regress to. */
  readonly positions: ReadonlyMap<string, Position>;
}

/** Which share of a `PlayerWeekUsage` a calculation is about. */
type ShareField = "snapShare" | "targetShare" | "carryShare" | "passAttemptShare";

/**
 * The whole season, because the decay does the discounting. A separate window would be a second
 * knob controlling the same thing, and two knobs that fight are how a model becomes undebuggable.
 */
const WINDOW = LAST_POSSIBLE_WEEK;

/** A share is a fraction; nothing downstream is prepared for one that is not. */
function clampShare(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * One shrinkage step: `weight` games of evidence saying `estimate`, against a prior worth `k` games.
 *
 * `null` evidence returns the prior unchanged rather than zero, which is the whole "null is not
 * zero" discipline expressed in one line — a player with no record is not a player with no
 * opportunity.
 */
function shrink(estimate: number | null, weight: number, prior: number, k: number): number {
  if (estimate === null || weight <= 0) return prior;
  return (weight * estimate + k * prior) / (weight + k);
}

/** One player's weeks, split at the season boundary the two shrinkage levels sit either side of. */
interface PlayerHistory {
  readonly priorSeason: readonly PlayerWeekUsage[];
  readonly thisSeason: readonly PlayerWeekUsage[];
}

function weekly(rows: readonly PlayerWeekUsage[], field: ShareField): readonly WeeklyValue[] {
  return rows.map((row) => ({ week: row.week, value: row[field] }));
}

/**
 * A player's predicted share, through both levels.
 *
 * The prior season is averaged FLAT rather than recency-weighted: within a season that ended months
 * ago, week 3 and week 16 are equally stale, and pretending otherwise would dress an arbitrary
 * ordering up as information.
 */
function predictShare(history: PlayerHistory, field: ShareField, rolePrior: number, priors: OpportunityPriors, week: number): number {
  const priorRows = weekly(history.priorSeason, field);
  const priorMean = rollingOpportunity(priorRows, { window: WINDOW, decay: 1, anchorWeek: LAST_POSSIBLE_WEEK });
  const priorGames = rollingWeight(priorRows, { window: WINDOW, decay: 1, anchorWeek: LAST_POSSIBLE_WEEK });
  const level1 = shrink(priorMean, priorGames, rolePrior, priors.shrinkage.season);

  const thisRows = weekly(history.thisSeason, field);
  const form = rollingOpportunity(thisRows, { window: WINDOW, decay: priors.recencyDecay, anchorWeek: week });
  const formGames = rollingWeight(thisRows, { window: WINDOW, decay: priors.recencyDecay, anchorWeek: week });
  return clampShare(shrink(form, formGames, level1, priors.shrinkage.inSeason));
}

/** Team volume, same two levels, shrunk toward the league rather than toward a role. */
function predictVolume(
  history: PlayerHistory,
  field: "teamTargets" | "teamCarries" | "teamPassAttempts",
  leagueMean: number,
  priors: OpportunityPriors,
  week: number,
): number {
  // A team volume of zero is NO EVIDENCE, not evidence of a silent offence. No NFL team has ever
  // finished a game without throwing or running the ball, so a zero here means the week's rows were
  // never written — and averaging it in as a real observation would halve a whole offence's
  // projected volume on the strength of a gap in the feed.
  const rows = (source: readonly PlayerWeekUsage[]): readonly WeeklyValue[] =>
    source.map((row) => ({ week: row.week, value: row[field] === 0 ? null : row[field] }));
  const priorRows = rows(history.priorSeason);
  const level1 = shrink(
    rollingOpportunity(priorRows, { window: WINDOW, decay: 1, anchorWeek: LAST_POSSIBLE_WEEK }),
    rollingWeight(priorRows, { window: WINDOW, decay: 1, anchorWeek: LAST_POSSIBLE_WEEK }),
    leagueMean,
    priors.shrinkage.teamVolume,
  );
  const thisRows = rows(history.thisSeason);
  return Math.max(
    0,
    shrink(
      rollingOpportunity(thisRows, { window: WINDOW, decay: priors.recencyDecay, anchorWeek: week }),
      rollingWeight(thisRows, { window: WINDOW, decay: priors.recencyDecay, anchorWeek: week }),
      level1,
      priors.shrinkage.teamVolume,
    ),
  );
}

/**
 * Predicts one week's opportunity for every player the history carries.
 *
 * `history` may legitimately contain weeks at or after `context.week` — `replay` never passes any,
 * but a caller might, and the filtering is done here rather than trusted to the caller because a
 * model that quietly read the week it was predicting would look excellent and be worthless. Only
 * the PRIOR season and weeks strictly before the target are ever consulted, and the leakage test
 * pins that a prediction is byte-identical with and without the future attached.
 *
 * A player whose position does not narrow to one this product scores is omitted rather than given
 * a made-up role, matching `backtest.ts`: he is excluded from projections and actuals alike, so the
 * comparison stays over the same set of people.
 */
export function predictOpportunity(
  history: readonly PlayerWeekUsage[],
  { season, week, positions }: OpportunityContext,
  priors: OpportunityPriors,
): ReadonlyMap<string, PredictedOpportunity> {
  const byPlayer = new Map<string, { priorSeason: PlayerWeekUsage[]; thisSeason: PlayerWeekUsage[] }>();
  for (const row of history) {
    if (row.season === season && row.week >= week) continue;
    if (row.season > season || row.season < season - 1) continue;
    const entry = byPlayer.get(row.playerId) ?? { priorSeason: [], thisSeason: [] };
    (row.season === season ? entry.thisSeason : entry.priorSeason).push(row);
    byPlayer.set(row.playerId, entry);
  }

  const predictions = new Map<string, PredictedOpportunity>();
  // Sorted by player id rather than left in map order, following `naive.ts`: a source whose output
  // order depended on a database read's order would make a `ScoreCard` subtly irreproducible, and
  // rank correlation is sensitive to tie ordering.
  for (const playerId of [...byPlayer.keys()].sort()) {
    const position = positions.get(playerId);
    if (position === undefined) continue;
    const role = priors.byPosition[position];
    const playerHistory = byPlayer.get(playerId)!;
    // The position's own shrinkage, substituted in wholesale so `predictShare` needs no change of
    // its own — it already only ever reads `priors.recencyDecay` and `priors.shrinkage`.
    const sharePriors: OpportunityPriors = { ...priors, shrinkage: shareShrinkageFor(priors, position) };

    const snapShare = predictShare(playerHistory, "snapShare", role.snapShare, sharePriors, week);
    predictions.set(playerId, {
      playerId,
      snapShare,
      // Every other share regresses toward the role's slope against the snap share we just
      // predicted — the depth chart, read through the only signal we have for one.
      targetShare: predictShare(playerHistory, "targetShare", clampShare(role.targetsPerSnap * snapShare), sharePriors, week),
      carryShare: predictShare(playerHistory, "carryShare", clampShare(role.carriesPerSnap * snapShare), sharePriors, week),
      passAttemptShare: predictShare(playerHistory, "passAttemptShare", clampShare(role.passAttemptsPerSnap * snapShare), sharePriors, week),
      teamTargets: predictVolume(playerHistory, "teamTargets", priors.leagueTeamVolume.targets, priors, week),
      teamCarries: predictVolume(playerHistory, "teamCarries", priors.leagueTeamVolume.carries, priors, week),
      teamPassAttempts: predictVolume(playerHistory, "teamPassAttempts", priors.leagueTeamVolume.passAttempts, priors, week),
    });
  }
  return predictions;
}
