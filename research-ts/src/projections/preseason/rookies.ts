import type { Position } from "@research-ts/domain/player";
import type { PredictedOpportunity } from "../model/opportunity";
import { BUCKET_ANCHOR, DRAFT_BUCKETS, draftBucketFor, UNDRAFTED_PICK, type DraftBucket } from "./draft-buckets";
import { rookieCurve } from "./rookie-curve";

// Re-exported so no existing consumer of `DRAFT_BUCKETS`/`draftBucketFor`/`UNDRAFTED_PICK`/
// `DraftBucket` from `"./rookies"` has to change — see `draft-buckets.ts`'s own module docblock for
// why these moved there (an import cycle `rookie-curve.ts` would otherwise hit).
export { DRAFT_BUCKETS, draftBucketFor, UNDRAFTED_PICK, type DraftBucket };

/**
 * ROOKIES — no NFL history at all, so DRAFT CAPITAL carries them.
 *
 * Every technique in Phases 2 and 3 leans on usage the player has already produced. A rookie has
 * none, which is why `modelProjection` does not emit a line for him at all: layer 1 needs some
 * history and layer 2 needs a week where an outcome and an opportunity row line up, and a rookie in
 * August has neither. On a weekly board that omission is correct and costs almost nothing. On a
 * draft board it is a hole where four of the first twenty picks go.
 *
 * WHERE A TEAM SPENT A PICK STATES THE ROLE IT INTENDS, before any evidence exists. A club that
 * spends the twelfth pick on a back has decided he is the back; a club that spends the hundred and
 * seventieth has decided nothing. That is not a proxy for talent, it is a directly observable
 * statement of intent by the only people who get to hand out the carries, and it is available in
 * April, which is what makes it usable here.
 *
 * LANDING SPOT WAS THE SECOND HALF, AND IT MEASURED WORSE THAN DRAFT CAPITAL ALONE. The argument
 * for it is still the one below: two identical backs are not identical when one of them is behind a
 * man who took three hundred carries last year. The measurement disagreed, on both held-out seasons
 * and badly on one — judged on the rookie segment against ranking the class by pick number, the
 * board with the landing term scored 0.3733 against 0.6374 in 2023 and 0.6459 against 0.6790 in
 * 2024. It is bounded to half in either direction, which is enough to move a first-round back below
 * a third-round one, and on that evidence the reordering destroys more information than it adds. It
 * is now behind `PreseasonFeatures.rookieLanding` and that flag is OFF.
 *
 * (Every figure in this docblock, including these, was measured BEFORE Task 4's curve-shaped
 * interpolation existed, against the original linear-in-pick blend. They are not re-run here.)
 *
 * WHAT REPLACES IT IS THE PICK NUMBER ITSELF. The buckets below are the level the fit can estimate;
 * they are not the resolution a draft has. Six cells rank the third pick level with the thirty-first
 * and the fitted table caps ties into place on top of that, so a bucket-only board hands a whole
 * round a single number and lets availability break it. `capitalShares` interpolates between the
 * buckets, which keeps every fitted mean where the fit put it and makes the class order by draft
 * capital in between — the ordering the counterfactual uses and the one this module had to beat.
 *
 * TASK 4: THE INTERPOLATION ITSELF NOW FOLLOWS A MEASURED SHAPE RATHER THAN THE RAW PICK NUMBER.
 * `rookie-curve.ts` fits expected rookie-season POINTS directly against outcomes, isotonic in the
 * pick, and `capitalCurveWeight` uses it to decide how far along two bucket anchors a pick sits —
 * in points space, not in pick-count space. Every fitted bucket MEAN is untouched by this; only the
 * blend BETWEEN two of them moves, and only where the curve has a real, non-degenerate signal to
 * offer (it falls back to the original linear-in-pick blend otherwise). See `rookie-curve.ts`'s own
 * module docblock for what is fit and on which seasons.
 *
 * THE DISTRIBUTION IS WIDER, AND NOT BY A RULE WRITTEN HERE. `availability.ts` narrows its spread
 * with the length of a player's record; a rookie's record is empty, so his distribution comes out
 * widest without this module saying anything about it. That is deliberate — a hand-set "rookies are
 * uncertain" multiplier would be a number nobody measured, and this way the width is whatever the
 * fit seasons said the width of an unknown player is.
 *
 * WHAT IS DELIBERATELY NOT IN HERE. College production is a genuine signal and a separate data
 * acquisition, and the plan's instruction is explicit: do not add it in this task, because this task
 * must be measurable without it. Athletic testing likewise. Adding either would make the ablation
 * measure two things at once.
 */

/** The shares a rookie is expected to take, before his landing spot is considered. */
export interface RookieShares {
  readonly snapShare: number;
  readonly targetShare: number;
  readonly carryShare: number;
  readonly passAttemptShare: number;
}

export interface RookiePriors {
  /** Expected shares per position and draft bucket, from the fit seasons' own rookie classes. */
  readonly byBucket: Readonly<Record<Position, Readonly<Record<DraftBucket, RookieShares>>>>;
  /**
   * League-average team volume, so a rookie's shares become counts the same way a veteran's do.
   * Taken from the opportunity priors rather than re-derived, so both layers size an offence
   * identically and a rookie is never quietly given a bigger pie than the man ahead of him.
   */
  readonly leagueTeamVolume: { readonly targets: number; readonly carries: number; readonly passAttempts: number };
  /**
   * How much of his position group's work is typically already claimed by returning players on the
   * team a rookie lands on. The denominator the competition term is measured against, so a neutral
   * landing spot comes out at exactly 1.
   */
  readonly typicalIncumbentClaim: Readonly<Record<Position, number>>;
  /**
   * The share of his team's games a rookie of each position and each level of capital plays,
   * measured over EVERY rookie in the cell including the ones who never dressed. See
   * `capitalGameRate` for why this table exists and what its absence cost.
   */
  readonly gameRate: Readonly<Record<Position, Readonly<Record<DraftBucket, number>>>>;
  /**
   * The most the landing spot may move a capital prior, either way.
   *
   * Bounded on purpose. A depth chart in August is a much weaker claim than a first-round pick — it
   * is a coach's current opinion about players who have not been hit yet — and an unbounded
   * competition term would let it overturn one. Half in either direction is enough to separate the
   * back behind an entrenched starter from the back walking into an empty room, which is the case
   * this term exists for.
   */
  readonly landingBound: number;
}

/** Everything the rookie prior is allowed to know about one player. */
export interface RookieInput {
  readonly playerId: string;
  readonly position: Position;
  readonly team: string;
  /** Overall pick number, or null for an undrafted free agent. */
  readonly overallPick: number | null;
  /**
   * How much of his position group's target and carry share the returning roster already holds.
   * Summed from layer 1's own predicted shares, so "entrenched starter" means what the model
   * already believes rather than what a depth chart page says.
   */
  readonly incumbentClaim: number;
}

/**
 * WHICH RANKING OF A ROOKIE CLASS IS IN USE. Both flags are measured, never assumed.
 *
 * `PreseasonFeatures` carries these through from the board so an ablation can flip one at a time.
 */
export interface RookieFeatures {
  /**
   * The landing-spot competition term. OFF on the shipped board: it measured worse than ranking the
   * class by draft pick alone on both held-out seasons.
   */
  readonly landingSpot: boolean;
  /**
   * Interpolate the six fitted bucket means on the pick axis, so a class orders by draft capital
   * rather than in six flat steps. ON on the shipped board.
   */
  readonly pickCurve: boolean;
}

/**
 * WHERE ONE PICK SITS BETWEEN TWO ANCHORS, IN POINTS SPACE RATHER THAN IN RAW PICK SPACE.
 *
 * `alongTheCapitalCurve` used to blend linearly in the pick NUMBER — pick 40 was exactly 40% of the
 * way from the round-1 anchor to the round-2 one, regardless of what draft capital is actually worth
 * at either end. `rookie-curve.ts`'s draft-capital curve measures that shape directly, in expected
 * rookie-season POINTS, fit on real outcomes rather than assumed to be a straight line — see its own
 * module docblock for why the shape is not one. This is the baseline that curve now underpins: the
 * weight a pick gets between two bucket anchors comes from how far its OWN fitted points value sits
 * between the two anchors' points values, so a class still orders by draft capital (every fitted
 * bucket mean is exactly where the fit put it, unchanged) but the picks IN BETWEEN move at the rate
 * the curve says capital actually decays at, not at the rate the pick number happens to count up.
 *
 * FALLS BACK TO LINEAR-IN-PICK when the curve has no signal to offer — `span` non-positive covers a
 * position the curve carries no knots for (K, DEF) and the degenerate case where the curve reads
 * identically at both anchors. Never throws and never divides by zero.
 */
function capitalCurveWeight(position: Position, abovePick: number, overallPick: number, belowPick: number): number {
  const linear = (overallPick - abovePick) / (belowPick - abovePick);
  const aboveValue = rookieCurve(position, abovePick);
  const belowValue = rookieCurve(position, belowPick);
  const span = aboveValue - belowValue;
  if (!(span > 0)) return linear;
  const pickValue = rookieCurve(position, overallPick);
  return Math.min(1, Math.max(0, (aboveValue - pickValue) / span));
}

/**
 * Where one bucket table lands for one pick, blending the two cells the pick falls between.
 *
 * Shared by the share table and the game-rate table so the two can never interpolate differently,
 * and generic in the cell type because "blend two cells" is the whole of what differs between them.
 */
function alongTheCapitalCurve<T>(
  cells: Readonly<Record<DraftBucket, T>>,
  position: Position,
  overallPick: number | null,
  pickCurve: boolean,
  blend: (above: T, below: T, weight: number) => T,
): T {
  if (!pickCurve) return cells[draftBucketFor(overallPick)];
  if (overallPick === null || overallPick <= 0) return cells.undrafted;

  const anchors = DRAFT_BUCKETS.map((bucket) => ({ pick: BUCKET_ANCHOR[bucket], cell: cells[bucket] }));
  const first = anchors[0]!;
  const last = anchors[anchors.length - 1]!;
  // Clamped rather than extrapolated at both ends. Above the first anchor there is no measured cell
  // to run toward, and inventing a steeper first round would be a curve nobody fitted.
  if (overallPick <= first.pick) return first.cell;
  if (overallPick >= last.pick) return last.cell;

  const index = anchors.findIndex((anchor) => overallPick <= anchor.pick);
  const above = anchors[index - 1]!;
  const below = anchors[index]!;
  return blend(above.cell, below.cell, capitalCurveWeight(position, above.pick, overallPick, below.pick));
}

/** The shares draft capital alone implies, interpolated between the fitted bucket means. */
export function capitalShares(
  position: Position,
  overallPick: number | null,
  priors: RookiePriors,
  { pickCurve }: RookieFeatures,
): RookieShares {
  return alongTheCapitalCurve(priors.byBucket[position], position, overallPick, pickCurve, (above, below, weight) => {
    const between = (high: number, low: number): number => high + (low - high) * weight;
    return {
      snapShare: between(above.snapShare, below.snapShare),
      targetShare: between(above.targetShare, below.targetShare),
      carryShare: between(above.carryShare, below.carryShare),
      passAttemptShare: between(above.passAttemptShare, below.passAttemptShare),
    };
  });
}

/**
 * THE SHARE OF HIS TEAM'S GAMES A ROOKIE OF THIS CAPITAL PLAYS, over the whole class and not only
 * over the ones who made the field.
 *
 * This is the other half of the decomposition `fit.ts` describes, and the half the first version of
 * this board did not have. The share table above is conditional on playing, which is the right
 * per-game number; without an unconditional companion, the availability model was left to guess how
 * often a rookie plays from a snap share that already assumed he did. It guessed that every rookie
 * quarterback in the league was a starter, projected the undrafted ones above the best receiver in
 * the class, and that single cross-position error was most of what made the rookie ordering worse
 * than sorting the class by pick number.
 */
export function capitalGameRate(
  position: Position,
  overallPick: number | null,
  priors: RookiePriors,
  { pickCurve }: RookieFeatures,
): number {
  return alongTheCapitalCurve(
    priors.gameRate[position],
    position,
    overallPick,
    pickCurve,
    (above, below, weight) => above + (below - above) * weight,
  );
}

/**
 * How much the landing spot moves the capital prior.
 *
 * A room where returning players already hold twice the typical share of the work halves the
 * rookie's projection; an empty room raises it by the same bound. Linear in the RATIO rather than
 * in the difference, so the term means the same thing at a position where incumbents typically hold
 * eighty percent as at one where they hold thirty.
 */
export function landingMultiplier(input: RookieInput, priors: RookiePriors): number {
  const typical = priors.typicalIncumbentClaim[input.position];
  if (!(typical > 0)) return 1;
  const ratio = input.incumbentClaim / typical;
  const raw = 1 - (ratio - 1);
  return Math.min(1 + priors.landingBound, Math.max(1 - priors.landingBound, raw));
}

/**
 * ONE ROOKIE'S PREDICTED OPPORTUNITY, in the same shape layer 1 emits for everybody else.
 *
 * Returning a `PredictedOpportunity` rather than a private type is what lets the board treat a
 * rookie and a veteran identically from here on: the same efficiency layer, the same composition,
 * the same scoring, the same value over replacement. A parallel rookie pipeline would be a second
 * place for the arithmetic to drift, and it would make "how does the board rank rookies against
 * veterans" a question about two models rather than one.
 */
export function rookieOpportunity(
  input: RookieInput,
  priors: RookiePriors,
  features: RookieFeatures,
): PredictedOpportunity {
  const shares = capitalShares(input.position, input.overallPick, priors, features);
  const multiplier = features.landingSpot ? landingMultiplier(input, priors) : 1;
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  return {
    playerId: input.playerId,
    // Snap share carries the landing spot too: a rookie behind an entrenched starter is not merely
    // less efficient with his snaps, he takes fewer of them, and layer 1 reads snap share as the
    // depth chart everywhere else in the engine.
    snapShare: clamp(shares.snapShare * multiplier),
    targetShare: clamp(shares.targetShare * multiplier),
    carryShare: clamp(shares.carryShare * multiplier),
    // A rookie quarterback's pass-attempt share is the one that does NOT take the landing
    // adjustment twice: the bucket prior already encodes that a first-round quarterback starts and a
    // sixth-round one does not, and multiplying by the incumbent claim as well would rate a rookie
    // behind a franchise starter at a share the bucket has already set near zero.
    passAttemptShare: clamp(shares.passAttemptShare),
    teamTargets: priors.leagueTeamVolume.targets,
    teamCarries: priors.leagueTeamVolume.carries,
    teamPassAttempts: priors.leagueTeamVolume.passAttempts,
  };
}
