import type { Position } from "@/domain/player";
import type { PredictedOpportunity } from "../model/opportunity";

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
 * LANDING SPOT IS THE SECOND HALF, and without it draft capital alone would rank two identical
 * backs identically when one of them is behind a man who took three hundred carries last year. The
 * competition term is bounded rather than free: it adjusts a capital prior by up to half in either
 * direction and can never overturn it, because a depth chart in August is a weaker claim than a
 * first-round pick.
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

/**
 * The draft-capital buckets the prior is estimated in.
 *
 * Buckets rather than a curve on the pick number, for the reason `availability.ts` brackets age: the
 * shape is not a line and it is not an exponential either. The gap between pick 5 and pick 25 is
 * enormous, the gap between 130 and 150 is nothing, and the gap between the last pick and the first
 * undrafted free agent is real but small. Six buckets say that; a fitted decay would smooth it into
 * something that is wrong at both ends.
 */
export const DRAFT_BUCKETS = ["round1", "round2", "round3", "rounds4to5", "rounds6to7", "undrafted"] as const;
export type DraftBucket = (typeof DRAFT_BUCKETS)[number];

/**
 * Which bucket an overall pick falls in.
 *
 * Boundaries are the modern seven-round draft's own: 32 picks a round, plus compensatory selections
 * which push each round's real end a little later. The bucket edges use the nominal round lengths
 * because a compensatory pick at the end of round three is, in every way that matters to a depth
 * chart, a round-four pick.
 */
export function draftBucketFor(overallPick: number | null): DraftBucket {
  if (overallPick === null || overallPick <= 0) return "undrafted";
  if (overallPick <= 32) return "round1";
  if (overallPick <= 64) return "round2";
  if (overallPick <= 105) return "round3";
  if (overallPick <= 180) return "rounds4to5";
  return "rounds6to7";
}

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
export function rookieOpportunity(input: RookieInput, priors: RookiePriors): PredictedOpportunity {
  const shares = priors.byBucket[input.position][draftBucketFor(input.overallPick)];
  const multiplier = landingMultiplier(input, priors);
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
