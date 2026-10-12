/**
 * THE DRAFT-CAPITAL BUCKETS — extracted from `rookies.ts` (fix round 1, 2026-09-04) so
 * `rookie-curve.ts` can bucket its own historical games-played rate on the IDENTICAL boundaries
 * `rookies.ts`'s share/game-rate tables use, without creating an import cycle: `rookies.ts` already
 * imports `rookieCurve` from `./rookie-curve`, so `rookie-curve.ts` importing bucket primitives back
 * FROM `rookies.ts` would cycle. Both modules import from here instead, and `rookies.ts` re-exports
 * everything below so no existing consumer (`fit.ts`, the fit scripts, every test that imports
 * `DRAFT_BUCKETS`/`draftBucketFor` from `"./rookies"`) has to change.
 */

/**
 * The draft-capital buckets every draft-capital-conditioned prior in this engine is estimated in.
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
 * Where an undrafted man sits on the pick axis: behind the last pick of a seven-round draft.
 *
 * One constant, consumed by the capital curve and by the draft-capital counterfactual the research
 * script scores against it, so nothing can disagree about what "undrafted" means.
 */
export const UNDRAFTED_PICK = 300;

/**
 * The pick each bucket's fitted mean is anchored at: the middle of the picks that bucket covers.
 *
 * A bucket mean is an average over its members, so the pick it describes is the middle of the
 * bucket rather than its first pick. Anchoring at the midpoint and interpolating between anchors
 * leaves every fitted mean exactly where the fit put it and invents nothing in between — the value
 * at pick 48 is the round-2 mean because that is what was measured, and the value at pick 40 is
 * between the round-1 and round-2 means because a fit over six cells has nothing finer to say.
 */
export const BUCKET_ANCHOR: Readonly<Record<DraftBucket, number>> = {
  round1: 16.5,
  round2: 48.5,
  round3: 84.5,
  rounds4to5: 142.5,
  rounds6to7: 220,
  undrafted: UNDRAFTED_PICK,
};

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
