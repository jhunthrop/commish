import { spearman } from "../metrics";

/**
 * THE FOUR PREREGISTERED GATES, AS PURE FUNCTIONS (the 2026-09-05 kicker and team defence round).
 *
 * The thresholds below are the spec's own, copied verbatim, and they are constants rather than
 * literals at a call site for one reason: the judgment run and the ongoing harness must be able to
 * measure THE SAME THING. A gate that lives in a script is a gate nobody can test, and a gate
 * restated in two places is a gate that will disagree with itself the first time one of them is
 * edited.
 *
 * A GATE THAT CANNOT ANSWER FAILS. Every function here returns `passed: false` for a sample too thin
 * to measure, never `true`, following `metrics.ts`' own rule that a sample which cannot answer says
 * so. The decision rule this feeds ships a position in market order when a gate fails, and shipping
 * a labelled market order because the evidence was absent is honest; shipping projected points
 * because a gate was vacuously satisfied is not.
 */

/** One gate's verdict, with the numbers a results document can quote without recomputing them. */
export interface GateResult {
  readonly name: string;
  readonly passed: boolean;
  /** Every number behind the verdict, in a form the results document quotes verbatim. */
  readonly detail: string;
}

/** The spec's own thresholds (§5 Phase B), copied verbatim. */
export const GATE_THRESHOLDS = {
  /** G1: "beats the last-season-order baseline by at least 0.05". */
  orderingBeatsLastSeasonBy: 0.05,
  /** G2: "no worse than the ADP baseline by more than 0.02". */
  marketShortfallAllowed: 0.02,
  /** G3: "covers between 40% and 60% of 2025 actuals". */
  coverage: { min: 0.4, max: 0.6 },
} as const;

export interface OrderingGateInput {
  /** Higher is better, in whatever unit. Only the ORDER is read. */
  readonly model: ReadonlyMap<string, number>;
  /** The arm the model has to beat (G1) or hold level with (G2). Higher is better here too, so a
   *  rank-based baseline must be negated by the caller before it arrives. */
  readonly baseline: ReadonlyMap<string, number>;
  readonly actual: ReadonlyMap<string, number>;
  /** The population the comparison is scored over. */
  readonly eligible: ReadonlySet<string>;
}

/** The players every side has an opinion about — never a union, so neither arm is credited for
 *  breadth the other one lacks. */
function commonPlayers(input: OrderingGateInput): readonly string[] {
  return [...input.eligible]
    .filter((playerId) => input.model.has(playerId) && input.baseline.has(playerId) && input.actual.has(playerId))
    .sort();
}

function correlationsOf(input: OrderingGateInput): { readonly model: number | null; readonly baseline: number | null; readonly size: number } {
  const players = commonPlayers(input);
  const model = spearman(players.map((playerId) => ({ predicted: input.model.get(playerId)!, actual: input.actual.get(playerId)! })));
  const baseline = spearman(players.map((playerId) => ({ predicted: input.baseline.get(playerId)!, actual: input.actual.get(playerId)! })));
  return { model, baseline, size: players.length };
}

function formatted(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

/**
 * G1 ORDERING. Spearman of the model's rank against actual season points beats the last-season-order
 * baseline by at least `orderingBeatsLastSeasonBy`.
 */
export function gateOrdering(input: OrderingGateInput): GateResult {
  const { model, baseline, size } = correlationsOf(input);
  if (model === null || baseline === null) {
    return {
      name: "G1 ordering",
      passed: false,
      detail: `cannot answer: model ${formatted(model)}, last-season order ${formatted(baseline)}, n=${size}`,
    };
  }
  const margin = model - baseline;
  return {
    name: "G1 ordering",
    passed: margin >= GATE_THRESHOLDS.orderingBeatsLastSeasonBy,
    detail:
      `model ${formatted(model)} against last-season order ${formatted(baseline)}, ` +
      `margin ${margin >= 0 ? "+" : ""}${margin.toFixed(4)} against a bar of ${GATE_THRESHOLDS.orderingBeatsLastSeasonBy}, n=${size}`,
  };
}

/**
 * G2 MARKET. On the market-covered subset, the model's Spearman is no worse than the market
 * baseline's by more than `marketShortfallAllowed`.
 */
export function gateMarket(input: OrderingGateInput): GateResult {
  const { model, baseline, size } = correlationsOf(input);
  if (model === null || baseline === null) {
    return {
      name: "G2 market",
      passed: false,
      detail: `cannot answer: model ${formatted(model)}, market ${formatted(baseline)}, n=${size}`,
    };
  }
  const margin = model - baseline;
  return {
    name: "G2 market",
    passed: margin >= -GATE_THRESHOLDS.marketShortfallAllowed,
    detail:
      `model ${formatted(model)} against market ${formatted(baseline)}, ` +
      `margin ${margin >= 0 ? "+" : ""}${margin.toFixed(4)} against an allowed shortfall of ${GATE_THRESHOLDS.marketShortfallAllowed}, n=${size}`,
  };
}

/** One candidate's band, in whatever percentile pair the caller chose. See the preregistration for
 *  which pair the judgment uses and why it is not the pair the board renders. */
export interface CalibrationBand {
  readonly playerId: string;
  readonly floor: number;
  readonly ceiling: number;
}

/**
 * G3 CALIBRATION. The band covers between `coverage.min` and `coverage.max` of the actual outcomes.
 *
 * A value exactly on a boundary counts as covered: the band is an interval the model is claiming the
 * outcome falls in, and excluding its endpoints would be scoring the model against a claim it did
 * not make.
 */
export function gateCalibration(bands: readonly CalibrationBand[], actual: ReadonlyMap<string, number>): GateResult {
  const scorable = bands.filter((band) => actual.has(band.playerId));
  if (scorable.length === 0) {
    return { name: "G3 calibration", passed: false, detail: "cannot answer: no band has an outcome to be scored against" };
  }
  const covered = scorable.filter((band) => {
    const outcome = actual.get(band.playerId)!;
    return outcome >= band.floor && outcome <= band.ceiling;
  }).length;
  const share = covered / scorable.length;
  return {
    name: "G3 calibration",
    passed: share >= GATE_THRESHOLDS.coverage.min && share <= GATE_THRESHOLDS.coverage.max,
    detail:
      `${covered} of ${scorable.length} outcomes inside the band, ${(share * 100).toFixed(1)}%, ` +
      `against a target of ${GATE_THRESHOLDS.coverage.min * 100}% to ${GATE_THRESHOLDS.coverage.max * 100}%`,
  };
}

/**
 * G4 ISOLATION. The QB, RB, WR and TE rows of the judgment board are byte-identical before and after
 * this whole round.
 *
 * Compared as already-rendered strings rather than as objects, deliberately: "byte-identical" is the
 * spec's own word, and a structural comparison would quietly forgive a floating-point difference in
 * the last decimal place that a rendered row shows.
 *
 * TWO EMPTY RENDERINGS FAIL. They prove nothing at all, and a gate that passes on no evidence is the
 * exact failure mode this whole scorecard is written to avoid.
 */
export function gateIsolation(before: readonly string[], after: readonly string[]): GateResult {
  if (before.length === 0 && after.length === 0) {
    return { name: "G4 isolation", passed: false, detail: "cannot answer: both renderings are empty, which proves nothing" };
  }
  if (before.length !== after.length) {
    return {
      name: "G4 isolation",
      passed: false,
      detail: `row count moved, ${before.length} before against ${after.length} after`,
    };
  }
  const firstDifference = before.findIndex((row, index) => row !== after[index]);
  if (firstDifference === -1) {
    return { name: "G4 isolation", passed: true, detail: `${before.length} rows byte-identical` };
  }
  return {
    name: "G4 isolation",
    passed: false,
    detail:
      `${before.length} rows compared, first difference at row ${firstDifference + 1}: ` +
      `${JSON.stringify(before[firstDifference])} became ${JSON.stringify(after[firstDifference])}`,
  };
}

/** What a position ships as. */
export type KdefVerdict = "projected" | "market_order";

/**
 * THE SPEC'S OWN DECISION RULE: a position that passes ALL FOUR gates ships as projected rows; one
 * that fails any of them ships in market order, labelled, with no projected points and no tier.
 *
 * An empty gate list is `market_order`, not `projected`. A position nobody measured has not earned a
 * projection, and the whole point of this function is that the failure branch is the default.
 */
export function decisionFor(gates: readonly GateResult[]): KdefVerdict {
  return gates.length > 0 && gates.every((gate) => gate.passed) ? "projected" : "market_order";
}
