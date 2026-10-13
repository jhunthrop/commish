import type { ScoringRules } from "@research-ts/scoring/compute";
import { BOARD_FORMAT_SPECS, DEFAULT_BOARD_FORMAT, type BoardFormat } from "../preseason/board-formats";
import type { BlendConstants, MarketTailByPosition } from "./blend";
import { FITTED_MARKET_CURVE } from "./curve-fitted";
import { FITTED_MARKET_CURVE_HALF } from "./curve-fitted-half";
import { FITTED_MARKET_CURVE_STD } from "./curve-fitted-std";
import { marketCurve, type CurvePosition, type MarketCurvePriors } from "./curve";

/**
 * THE ADP ANCHOR, PER FORMAT (the scoring-formats round, 2026-09-08) — everything the blend needs
 * that depends on which scoring a board is priced under: the feed whose draft slots it reads, the
 * curve that turns a slot into season points, the preset the raw arm is scored under, and the
 * unlisted tail that bounds a player the feed never drafted.
 *
 * THE FOUR MOVE TOGETHER OR NOT AT ALL. A half-PPR slot priced through the PPR curve would hand a
 * pass-catching back PPR points on a board that scores his catches at half; a PPR slot priced
 * through the half curve would do the reverse. So there is no way to ask this module for a curve
 * without also getting the feed and the rules that curve was fit against, and the PPR anchor is the
 * committed objects themselves, by reference, so the default board reproduces bit for bit.
 */
export interface FormatAnchor {
  readonly format: BoardFormat;
  readonly rules: ScoringRules;
  /** `preseason_rankings.source` of the board the blend anchors to. */
  readonly adpSource: string;
  readonly curve: MarketCurvePriors;
}

const CURVE_BY_FORMAT: Readonly<Record<BoardFormat, MarketCurvePriors>> = {
  ppr: FITTED_MARKET_CURVE,
  half: FITTED_MARKET_CURVE_HALF,
  std: FITTED_MARKET_CURVE_STD,
};

export function formatAnchorFor(format: BoardFormat): FormatAnchor {
  const spec = BOARD_FORMAT_SPECS[format];
  return { format, rules: spec.rules, adpSource: spec.adpSource, curve: CURVE_BY_FORMAT[format] };
}

const CURVE_POSITIONS: readonly CurvePosition[] = ["QB", "RB", "WR", "TE"];

/**
 * THE DEEP BAND THE TAIL EXCHANGE RATE IS READ OVER: draft slots 100 through 150. Every format's
 * fit is dense there (each pools scores of player-seasons per position across that stretch), and
 * it is the stretch the committed PPR tails themselves sit just past (their ranks run 159 to 173).
 * The very last knot of a curve is the one place a fit is a singleton, and reading a tail off it
 * is how the standard-scoring WR tail would have come out at exactly zero points (one drafted
 * receiver at slot 172 who never scored), capping every unlisted receiver at nothing.
 */
export const TAIL_EXCHANGE_BAND = { from: 100, to: 150 } as const;

function bandMean(priors: MarketCurvePriors, position: CurvePosition): number {
  let sum = 0;
  for (let rank = TAIL_EXCHANGE_BAND.from; rank <= TAIL_EXCHANGE_BAND.to; rank += 1) sum += marketCurve(position, rank, priors);
  return sum / (TAIL_EXCHANGE_BAND.to - TAIL_EXCHANGE_BAND.from + 1);
}

/**
 * THE UNLISTED TAIL IN ANOTHER FORMAT'S POINTS: the committed PPR tail per position, converted at
 * the rate the two curves exchange at over the deep band. The PPR tail is "the cheapest player the
 * market actually drafted at his position" priced in PPR points (`blend-fitted.ts`, measured over
 * the blend fit's own candidate-joined train rows); this keeps that DEPTH and restates the PRICE
 * in the format's own currency, which is what the same cheapest drafted man is worth on a board
 * that scores his catches differently. Under standard scoring a back keeps most of his PPR tail and
 * a receiver keeps less, which is the honest shape of the difference between the two formats.
 *
 * Throws when a curve has nothing in the band at a position (an empty curve reads as zero and a
 * zero-over-zero tail would be a number nobody measured).
 */
export function marketTailAtExchangeRate(base: MarketTailByPosition, pprCurve: MarketCurvePriors, formatCurve: MarketCurvePriors): MarketTailByPosition {
  const entries = CURVE_POSITIONS.map((position) => {
    const pprMean = bandMean(pprCurve, position);
    const formatMean = bandMean(formatCurve, position);
    if (!(pprMean > 0) || !(formatMean > 0)) {
      throw new Error(`marketTailAtExchangeRate: a curve carries nothing at ${position} across slots ${TAIL_EXCHANGE_BAND.from}-${TAIL_EXCHANGE_BAND.to}; no exchange rate can be read there.`);
    }
    return [position, (base[position] * formatMean) / pprMean] as const;
  });
  return Object.fromEntries(entries) as Record<CurvePosition, number>;
}

/**
 * The blend constants for one format: the committed object itself for PPR, and for the two other
 * formats the same caps and implied games with the tail restated in that format's points. Every
 * cap (`lawCapPoints`, `availabilityCapPoints`, `totalCapPoints`) stays in the points it was fit
 * in; a two-point law cap under half PPR is a slightly larger share of a smaller number, which the
 * research note records rather than re-fits.
 */
export function blendConstantsFor(base: BlendConstants, format: BoardFormat): BlendConstants {
  if (format === DEFAULT_BOARD_FORMAT) return base;
  return { ...base, marketTailByPosition: marketTailAtExchangeRate(base.marketTailByPosition, FITTED_MARKET_CURVE, CURVE_BY_FORMAT[format]) };
}
