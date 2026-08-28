import type { PredictedOpportunity } from "../model/opportunity";
import type { PlayerWeekObservation } from "../store";
import { INJURY_METRICS, INJURY_SOURCE, PRACTICE_STATUS, REPORT_STATUS } from "./retrieve";

/**
 * THE NEWS PASS, TASK 7: THE ADJUSTMENT CONTRACT — and the contract matters more than the feature.
 *
 * The spec's rule, in one line: **the model WEIGHS retrieved facts and NEVER generates them.** In a
 * product where entry fees ride on the output, an invented injury is not a bug to be fixed in the
 * next release; it is the kind of thing that ends a company. So this file is written as a set of
 * refusals, and its tests were written before it was.
 *
 * Every adjustment that reaches a projection:
 *
 *   1. is STRUCTURED. There is no free-text field anywhere in this pipeline. The store holds numbers,
 *      `retrieve.ts` maps four published words to four integers, and nothing between here and the
 *      scoreboard can express a sentence. A layer that cannot write prose cannot invent a fact.
 *   2. carries a CITATION — the feed, the row, and when it was filed. No citation, no ship, and
 *      `acceptAdjustment` rejects rather than warning. A number nobody can trace to a publication is
 *      a number somebody made up, whether or not they meant to.
 *   3. carries a CONFIDENCE, in `(0, 1]`, which SCALES the effect toward doing nothing. A weak signal
 *      does not get to move a projection as far as a strong one.
 *   4. carries an EXPIRY. An injury report is published about one game. Three weeks later it is not
 *      weak evidence, it is stale evidence, and stale evidence that keeps applying is how a returning
 *      starter stays benched by a model forever.
 *   5. may only move a BOUNDED MULTIPLIER ON OPPORTUNITY. Never a component value, never an
 *      efficiency, never a team volume. A man who is hurt gets fewer snaps; he does not become worse
 *      at catching. The distinction is not pedantry — a layer that can set a component outright can
 *      invent one, and the layer beneath it stops being measurable.
 *
 * ALL FIVE ARE ENFORCED AT ONE DOOR. `acceptAdjustment` is the only way an adjustment reaches
 * `applyNews`, and it returns a typed refusal rather than throwing, because the caller's honest
 * response to a bad adjustment is to drop it and count it — not to fail a whole week's projections
 * because one feed row was malformed.
 */

/** Where an adjustment came from. Reconstructible from the stored observation, never free text. */
export interface NewsCitation {
  /** The feed that published it — `nflverse_injuries`. */
  readonly source: string;
  /** The exact row: which player, which week, which metric. Enough to go and look it up. */
  readonly metric: string;
  readonly season: number;
  readonly week: number;
  /** When the publisher filed it. NOT when we read it. */
  readonly filedAt: Date;
}

/**
 * The only thing an adjustment is allowed to move, named as a value so it cannot be widened by
 * accident. A second member here is a change to the contract and should be argued for in a review,
 * not typed in passing.
 */
export const ADJUSTABLE_COMPONENT = "opportunity" as const;

export interface NewsAdjustment {
  readonly playerId: string;
  readonly component: typeof ADJUSTABLE_COMPONENT;
  /** The factor on every one of his shares. 1 is "this changes nothing". */
  readonly multiplier: number;
  /** In `(0, 1]`. Scales the multiplier toward 1 — a weak signal moves a projection less far. */
  readonly confidence: number;
  /** After this instant the adjustment stops applying. Never open-ended. */
  readonly expiresAt: Date;
  readonly citation: NewsCitation;
}

/**
 * How far a cited, unexpired adjustment may move a player's opportunity.
 *
 * ZERO IS A LEGITIMATE FLOOR and is the reason this bound is not symmetric with the context layer's.
 * A man ruled out does not take 80% of his usual snaps; he takes none, and a bound that could not
 * express that would be a bound that made the feature useless for the one case it exists for.
 *
 * The ceiling is deliberately tight. Ruling somebody out is a published fact about him; promoting
 * his backup is an INFERENCE about somebody else, and this layer has no business making a large one.
 * The redistribution group is where a teammate's promotion belongs, it was measured in Phase 3, and
 * layer 1 turned out to be doing nine tenths of it already.
 */
export const NEWS_MULTIPLIER_BOUND = { min: 0, max: 1.2 } as const;

/** Why an adjustment was refused. Typed, because the counts mean different operator actions. */
export type NewsRefusal =
  /** No citation, or a citation that names no source. The unforgivable one. */
  | "uncited"
  /** Filed for a game that has been and gone. */
  | "expired"
  /** Outside `NEWS_MULTIPLIER_BOUND`, or not a number at all. */
  | "out_of_bounds"
  /** Outside `(0, 1]`, or not a number at all. */
  | "bad_confidence"
  /** Anything other than `opportunity`. */
  | "wrong_component";

export type NewsVerdict =
  | { readonly accepted: true; readonly adjustment: NewsAdjustment }
  | { readonly accepted: false; readonly refusal: NewsRefusal };

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/**
 * The one door. Every rule above, checked in the order a reviewer would check them.
 *
 * `at` is the moment the projection is being made for, and expiry is judged against it rather than
 * against the wall clock — a backtest replaying October 2023 must apply exactly the adjustments that
 * were live in October 2023, and a `Date.now()` in here would make every historical projection use
 * an empty news layer while today's used a full one.
 */
export function acceptAdjustment(candidate: NewsAdjustment, at: Date): NewsVerdict {
  const refuse = (refusal: NewsRefusal): NewsVerdict => ({ accepted: false, refusal });
  const citation = candidate.citation as NewsCitation | undefined;
  if (
    citation === undefined ||
    citation.source.trim() === "" ||
    citation.metric.trim() === "" ||
    !(citation.filedAt instanceof Date) ||
    Number.isNaN(citation.filedAt.getTime())
  ) {
    return refuse("uncited");
  }
  if (candidate.component !== ADJUSTABLE_COMPONENT) return refuse("wrong_component");
  if (!(candidate.expiresAt instanceof Date) || Number.isNaN(candidate.expiresAt.getTime())) return refuse("expired");
  if (candidate.expiresAt.getTime() <= at.getTime()) return refuse("expired");
  if (!Number.isFinite(candidate.multiplier) || candidate.multiplier < NEWS_MULTIPLIER_BOUND.min || candidate.multiplier > NEWS_MULTIPLIER_BOUND.max) {
    return refuse("out_of_bounds");
  }
  if (!isPositive(candidate.confidence) || candidate.confidence > 1) return refuse("bad_confidence");
  return { accepted: true, adjustment: candidate };
}

/**
 * The factor actually applied: the multiplier pulled toward 1 by the confidence.
 *
 * Written as one line so the weighing is visible rather than buried. At confidence 1 the adjustment
 * applies in full; at 0.5 it applies half way; as confidence approaches 0 it does nothing. This is
 * the whole of what "the model weighs retrieved facts" means in arithmetic.
 */
export function weighedMultiplier(adjustment: NewsAdjustment): number {
  return 1 + adjustment.confidence * (adjustment.multiplier - 1);
}

/** What a week's news pass did, so an operator can see it did anything at all. */
export interface NewsApplication {
  readonly opportunity: ReadonlyMap<string, PredictedOpportunity>;
  readonly applied: number;
  readonly refused: Readonly<Record<NewsRefusal, number>>;
}

const NO_REFUSALS: Readonly<Record<NewsRefusal, number>> = {
  uncited: 0,
  expired: 0,
  out_of_bounds: 0,
  bad_confidence: 0,
  wrong_component: 0,
};

/**
 * Applies every accepted adjustment to the four shares, and nothing else.
 *
 * ALL FOUR SHARES BY THE SAME FACTOR, because availability is not selective: a man who does not play
 * takes no snaps, no targets, no carries and no throws. Scaling one and not the others would be a
 * claim about how his role changes when he is hurt, which is not what an injury report says.
 *
 * The team volumes are untouched. His offence still runs its plays; somebody else takes them. Who
 * that is belongs to the redistribution group, which was measured in Phase 3 and found to be
 * something layer 1 largely does already.
 *
 * Two adjustments for one player MULTIPLY rather than the last one winning. It is the composition
 * that keeps this associative and order-free, which matters because the store returns rows in an
 * order chosen for reproducibility rather than for meaning.
 */
export function applyNews(
  opportunity: ReadonlyMap<string, PredictedOpportunity>,
  candidates: readonly NewsAdjustment[],
  at: Date,
): NewsApplication {
  const factors = new Map<string, number>();
  const refused = { ...NO_REFUSALS };
  let applied = 0;
  for (const candidate of candidates) {
    const verdict = acceptAdjustment(candidate, at);
    if (!verdict.accepted) {
      refused[verdict.refusal] += 1;
      continue;
    }
    applied += 1;
    factors.set(candidate.playerId, (factors.get(candidate.playerId) ?? 1) * weighedMultiplier(verdict.adjustment));
  }
  if (factors.size === 0) return { opportunity, applied, refused };

  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const adjusted = new Map<string, PredictedOpportunity>();
  for (const [playerId, player] of opportunity) {
    const factor = factors.get(playerId);
    if (factor === undefined) {
      adjusted.set(playerId, player);
      continue;
    }
    adjusted.set(playerId, {
      ...player,
      snapShare: clamp(player.snapShare * factor),
      targetShare: clamp(player.targetShare * factor),
      carryShare: clamp(player.carryShare * factor),
      passAttemptShare: clamp(player.passAttemptShare * factor),
    });
  }
  return { opportunity: adjusted, applied, refused };
}

/**
 * What one designation is worth, and how sure of it the measurement is. Fitted — see `news-fit.ts`.
 */
export interface DesignationEffect {
  readonly multiplier: number;
  readonly confidence: number;
}

/**
 * The fitted table the derivation reads: one effect per published designation.
 *
 * Keyed by the ordinals `retrieve.ts` publishes rather than by their names, so a rename upstream
 * cannot silently re-point a multiplier at the wrong designation.
 */
export interface NewsPriors {
  /** Effects for report statuses 1..3 (Questionable, Doubtful, Out). */
  readonly reportStatus: Readonly<Record<string, DesignationEffect>>;
  /** Effects for practice statuses 1..3 (Full, Limited, Did Not Participate). */
  readonly practiceStatus: Readonly<Record<string, DesignationEffect>>;
  /**
   * How long after filing an injury designation stops applying.
   *
   * A report is published about ONE game. Ten days is a week and a half — long enough that a filing
   * survives to the game it was about however the schedule falls, short enough that it cannot still
   * be suppressing a man who has been back for a fortnight.
   */
  readonly validityHours: number;
}

/**
 * Turns visible observations into candidate adjustments. Generates nothing.
 *
 * The only decisions this function makes are lookups: which ordinal was published, what the fit
 * measured that ordinal to be worth, and when the publisher filed it. Every field of the resulting
 * adjustment traces to a row in the store, which is what makes the citation checkable rather than
 * decorative.
 *
 * A GAME STATUS OUTRANKS A PRACTICE STATUS for the same player-week, and only one of the two is ever
 * turned into an adjustment. They are not independent evidence — a Friday "Out" is the league's
 * conclusion FROM the week's practice — so applying both would multiply one fact by itself.
 */
export function newsAdjustments(observations: readonly PlayerWeekObservation[], priors: NewsPriors): readonly NewsAdjustment[] {
  const byPlayer = new Map<string, { report?: PlayerWeekObservation; practice?: PlayerWeekObservation }>();
  for (const observation of observations) {
    if (observation.source !== INJURY_SOURCE) continue;
    const entry = byPlayer.get(observation.playerId) ?? {};
    if (observation.metric === INJURY_METRICS.reportStatus && observation.value !== REPORT_STATUS.none) {
      entry.report = observation;
    }
    if (observation.metric === INJURY_METRICS.practiceStatus && observation.value !== PRACTICE_STATUS.none) {
      entry.practice = observation;
    }
    byPlayer.set(observation.playerId, entry);
  }

  const adjustments: NewsAdjustment[] = [];
  for (const [playerId, entry] of [...byPlayer.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const chosen = entry.report ?? entry.practice;
    if (chosen === undefined) continue;
    const table = chosen.metric === INJURY_METRICS.reportStatus ? priors.reportStatus : priors.practiceStatus;
    const effect = table[String(chosen.value)];
    // A designation the fit never measured produces NO adjustment. Falling back to a guessed
    // multiplier would be the model generating a fact rather than weighing one.
    if (effect === undefined) continue;
    adjustments.push({
      playerId,
      component: ADJUSTABLE_COMPONENT,
      multiplier: effect.multiplier,
      confidence: effect.confidence,
      expiresAt: new Date(chosen.asOf.getTime() + priors.validityHours * 3_600_000),
      citation: {
        source: chosen.source,
        metric: chosen.metric,
        season: chosen.season,
        week: chosen.week,
        filedAt: chosen.asOf,
      },
    });
  }
  return adjustments;
}
