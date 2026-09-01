import type { DiscoveryQuantityValues, LawPosition } from "../populations";

/**
 * THE DISCOVERY VOCABULARY — every quantity a candidate law's condition can threshold or delta on,
 * and the ONE mechanical renderer that turns a candidate's structural description (`ClaimParts`)
 * into a plain-words sentence. Nothing here reads a database or measures an effect; this file is
 * the shape of a claim, not its evidence.
 *
 * NO EXPECTED SIGN. A rendered claim states the CONDITION only — what has to be true of a player for
 * the candidate to apply — never "gains" or "loses" points, because the generator does not know
 * which way the effect runs until Task 7 measures it on the train window. `renderClaim`'s trailing
 * clause ("scores differently in points per game the following season") is the same words for every
 * candidate, on purpose: it is honest regardless of the sign the measurement eventually finds.
 */

/** Position-scoped vocabulary. `LawPosition` is `factsForSeason`'s own four skill positions — a
 *  candidate never targets "all", even though `Law["position"]` (the eventual registry shape) has
 *  that option; the generator always names one concrete position. */
export type { LawPosition };

export const QUANTILE_LEVELS = [0.7, 0.8, 0.9] as const;
export type QuantileLevel = (typeof QUANTILE_LEVELS)[number];

/** The percentile label a quantile LEVEL reads as in plain words: crossing the 0.8 quantile puts a
 *  player in the top 20% of his position. */
const QUANTILE_PERCENT_LABEL: Readonly<Record<QuantileLevel, string>> = {
  0.7: "30%",
  0.8: "20%",
  0.9: "10%",
};

/** Every quantity the candidate generator knows about, keyed by its `DiscoveryQuantityValues` field. */
export type QuantityId = keyof DiscoveryQuantityValues;

/** One quantity's identity: how to read it off `DiscoveryQuantityValues`, which positions it means
 *  something for, and the noun phrase `renderClaim` speaks it with (unit included in the words, so
 *  a sentence never needs a separate unit token). */
export interface QuantityDef {
  readonly id: QuantityId;
  readonly noun: string;
  readonly positions: readonly LawPosition[];
  readonly get: (values: DiscoveryQuantityValues) => number | null;
}

const ALL_SKILL_POSITIONS: readonly LawPosition[] = ["QB", "RB", "WR", "TE"];
const RECEIVING_POSITIONS: readonly LawPosition[] = ["RB", "WR", "TE"];
const PASS_CATCHER_POSITIONS: readonly LawPosition[] = ["WR", "TE"];

/**
 * THE QUANTITY REGISTRY, in a fixed declared order — every downstream iteration (`generate.ts`, the
 * quantile fit script) walks this array in this order, which is half of what makes candidate ids
 * stable across runs (the other half is `QUANTILE_LEVELS`' own fixed order and the canonical id-sort
 * `generateCandidatesFrom` applies before returning).
 */
export const QUANTITY_DEFS: readonly QuantityDef[] = [
  { id: "touches", noun: "combined carries and receptions that season", positions: ["RB"], get: (v) => v.touches },
  { id: "age", noun: "age at that season's opener", positions: ALL_SKILL_POSITIONS, get: (v) => v.age },
  {
    id: "targetShare",
    noun: "share of his team's targets that season",
    positions: RECEIVING_POSITIONS,
    get: (v) => v.targetShare,
  },
  {
    id: "touchdownPointsShare",
    noun: "share of his own fantasy points that came from touchdowns that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.touchdownPointsShare,
  },
  {
    id: "redZoneTouchShare",
    noun: "share of his own carries and targets that came in the red zone that season",
    positions: RECEIVING_POSITIONS,
    get: (v) => v.redZoneTouchShare,
  },
  {
    id: "targetDepth",
    noun: "average depth of target, in yards, that season",
    positions: PASS_CATCHER_POSITIONS,
    get: (v) => v.targetDepth,
  },
  {
    id: "snapShare",
    noun: "share of his team's offensive snaps that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.snapShare,
  },
  {
    id: "incomingCoachTenureSeasons",
    noun: "team's incoming play-caller's seasons of tenure with that team",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.incomingCoachTenureSeasons,
  },
  {
    id: "incomingCoachPriorPassRateOverExpected",
    noun: "team's incoming play-caller's own pass rate over expected at his previous teams",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.incomingCoachPriorPassRateOverExpected,
  },
  {
    id: "experienceYear",
    noun: "number of seasons in the league, counting that season itself",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.experienceYear,
  },
  {
    id: "teamPaceSecondsPerPlay",
    noun: "team's own seconds per offensive play that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.teamPaceSecondsPerPlay,
  },
];

const QUANTITY_BY_ID: ReadonlyMap<QuantityId, QuantityDef> = new Map(QUANTITY_DEFS.map((def) => [def.id, def] as const));

function quantityDef(id: QuantityId): QuantityDef {
  const def = QUANTITY_BY_ID.get(id);
  if (def === undefined) throw new Error(`No quantity registered for id "${id}".`);
  return def;
}

const POSITION_SINGULAR: Readonly<Record<LawPosition, string>> = {
  QB: "quarterback",
  RB: "running back",
  WR: "wide receiver",
  TE: "tight end",
};

const POSITION_PLURAL: Readonly<Record<LawPosition, string>> = {
  QB: "quarterbacks",
  RB: "running backs",
  WR: "wide receivers",
  TE: "tight ends",
};

/** A single threshold-crossing clause: the quantity is at or above its position's quantile mark. */
export interface ThresholdClause {
  readonly kind: "threshold";
  readonly quantityId: QuantityId;
  readonly quantileLevel: QuantileLevel;
}

/** A year-over-year clause: the quantity crossed the same quantile mark from the season before. */
export interface DeltaClause {
  readonly kind: "delta";
  readonly quantityId: QuantityId;
  readonly quantileLevel: QuantileLevel;
  readonly direction: "rose_into" | "fell_out_of";
}

export type SingleClause = ThresholdClause | DeltaClause;

/** An AND of exactly two single clauses — never nested further (at most two conditions, per the
 *  brief's own cap on how deep an AND-pair goes). */
export interface AndClause {
  readonly kind: "and";
  readonly left: SingleClause;
  readonly right: SingleClause;
}

export type Clause = SingleClause | AndClause;

/** A candidate's claim, structurally: the position it is scoped to, plus the clause describing its
 *  antecedent. `renderClaim` is the only function that turns this into English. */
export interface ClaimParts {
  readonly position: LawPosition;
  readonly clause: Clause;
}

function clauseText(clause: Clause, position: LawPosition): string {
  const plural = POSITION_PLURAL[position];
  switch (clause.kind) {
    case "threshold": {
      const pct = QUANTILE_PERCENT_LABEL[clause.quantileLevel];
      return `${quantityDef(clause.quantityId).noun} is in the top ${pct} of ${plural}`;
    }
    case "delta": {
      const pct = QUANTILE_PERCENT_LABEL[clause.quantileLevel];
      const noun = quantityDef(clause.quantityId).noun;
      return clause.direction === "rose_into"
        ? `${noun} climbed into the top ${pct} of ${plural} after being below it the year before`
        : `${noun} fell out of the top ${pct} of ${plural} after being in it the year before`;
    }
    case "and":
      return `${clauseText(clause.left, position)} and whose ${clauseText(clause.right, position)}`;
  }
}

const OUTCOME_CLAUSE = "scores differently in points per game the following season.";

/**
 * THE ONE TESTED RENDERER. Mechanical end to end: every word is either a fixed template fragment or
 * a `QUANTITY_DEFS` noun, never prose written per candidate. No em-dashes, matching every other
 * user-facing string in this engine.
 */
export function renderClaim(parts: ClaimParts): string {
  const singular = POSITION_SINGULAR[parts.position];
  const article = /^[aeiou]/i.test(singular) ? "An" : "A";
  return `${article} ${singular} whose ${clauseText(parts.clause, parts.position)} ${OUTCOME_CLAUSE}`;
}

/** One quantity's fitted train-window thresholds, at the three quantile levels this generator uses. */
export type QuantileThresholds = Readonly<Record<QuantileLevel, number>>;

/** Committed shape: a quantity may have no entry for a position (too few train-season observations
 *  to trust a quantile), which is why every level of nesting is `Partial`. */
export type QuantileTable = Partial<Record<QuantityId, Partial<Record<LawPosition, QuantileThresholds>>>>;

/** One player-season's raw quantities, tagged with the season and position they were measured at —
 *  the fit script's own input shape, and `computeQuantileTable`'s. */
export interface QuantityRow {
  readonly season: number;
  readonly position: LawPosition;
  readonly values: DiscoveryQuantityValues;
}

/** Below this many train-season observations, a position's quantile for a quantity is not computed
 *  at all (the combination is simply absent from the table) rather than published on a handful of
 *  player-seasons that one outlier could move by ten percentage points. */
export const MIN_QUANTILE_SAMPLE = 20;

/** Linear-interpolation quantile over an ALREADY-SORTED ascending array — the standard method every
 *  spreadsheet's `PERCENTILE.INC` uses, so a reader can check this against a tool they already trust. */
function interpolatedQuantile(sortedAscending: readonly number[], level: number): number {
  const index = level * (sortedAscending.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedAscending[lower]!;
  const weight = index - lower;
  return sortedAscending[lower]! * (1 - weight) + sortedAscending[upper]! * weight;
}

/**
 * THE TRAIN-WINDOW GATE, INSIDE THE PURE FUNCTION ITSELF rather than trusted to every caller: a row
 * whose `season` falls after `trainSeasons.to` is excluded here, not merely by convention at the
 * call site. A fit script that accidentally handed this function a full-window row (test seasons
 * included) still gets a train-only quantile table back — the same "the gate lives where the read
 * happens, not where the caller remembers to filter" discipline `populations.ts`'s own docblock
 * states for `factsForSeason`.
 */
export function computeQuantileTable(rows: readonly QuantityRow[], trainSeasons: { readonly to: number }): QuantileTable {
  const table: Record<string, Partial<Record<LawPosition, QuantileThresholds>>> = {};
  for (const def of QUANTITY_DEFS) {
    for (const position of def.positions) {
      const values = rows
        .filter((row) => row.season <= trainSeasons.to && row.position === position)
        .map((row) => def.get(row.values))
        .filter((value): value is number => value !== null)
        .sort((a, b) => a - b);
      if (values.length < MIN_QUANTILE_SAMPLE) continue;
      const thresholds = Object.fromEntries(
        QUANTILE_LEVELS.map((level) => [level, interpolatedQuantile(values, level)] as const),
      ) as QuantileThresholds;
      const forQuantity = (table[def.id] ??= {});
      forQuantity[position] = thresholds;
    }
  }
  return table as QuantileTable;
}
