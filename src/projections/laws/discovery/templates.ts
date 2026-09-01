import type { DiscoveryQuantityValues } from "../discovery-facts";
import type { LawPosition } from "../populations";

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
 *  a sentence never needs a separate unit token).
 *
 *  `formatValue` and `shortLabel` are the fix-round additions `renderSignedClaim`/`renderTitle` need
 *  (a committed candidate's claim now states the actual committed threshold — "129 or more" — rather
 *  than a quantile percentage; `renderClaim`, the neutral pre-measurement renderer, is UNCHANGED and
 *  keeps using `noun`/the quantile-percent label, since it never has a real number to show). */
export interface QuantityDef {
  readonly id: QuantityId;
  readonly noun: string;
  readonly positions: readonly LawPosition[];
  readonly get: (values: DiscoveryQuantityValues) => number | null;
  /** Formats a raw threshold VALUE (not a quantile level) into the plain-words token
   *  `renderSignedClaim` drops into "... is {formatValue(value)} or more". */
  readonly formatValue: (value: number) => string;
  /** A two-or-three-word label for `renderTitle`'s mechanical heading — never a full sentence, never
   *  hand-authored prose about a specific candidate. */
  readonly shortLabel: string;
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
/** Whole-number formatting — touches, tenure seasons, experience years: no fractional value in the
 *  underlying quantity is ever meaningful to a reader, even though a quantile interpolation can land
 *  on one (e.g. `237.29999999999995`). */
const formatWhole = (value: number): string => `${Math.round(value)}`;
/** One-decimal formatting — age, target depth, pace, all genuinely continuous quantities. */
const formatOneDecimal = (value: number): string => value.toFixed(1);
/** Percentage formatting for a 0..1 share/rate. */
const formatPercent = (value: number): string => `${Math.round(value * 100)}%`;

export const QUANTITY_DEFS: readonly QuantityDef[] = [
  {
    id: "touches",
    noun: "combined carries and receptions that season",
    positions: ["RB"],
    get: (v) => v.touches,
    formatValue: formatWhole,
    shortLabel: "carries and receptions",
  },
  {
    id: "age",
    noun: "age at that season's opener",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.age,
    formatValue: formatOneDecimal,
    shortLabel: "age",
  },
  {
    id: "targetShare",
    noun: "share of his team's targets that season",
    positions: RECEIVING_POSITIONS,
    get: (v) => v.targetShare,
    formatValue: formatPercent,
    shortLabel: "target share",
  },
  {
    id: "touchdownPointsShare",
    noun: "share of his own fantasy points that came from touchdowns that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.touchdownPointsShare,
    formatValue: formatPercent,
    shortLabel: "touchdown-points share",
  },
  {
    id: "redZoneTouchShare",
    noun: "share of his own carries and targets that came in the red zone that season",
    positions: RECEIVING_POSITIONS,
    get: (v) => v.redZoneTouchShare,
    formatValue: formatPercent,
    shortLabel: "red-zone touch share",
  },
  {
    id: "targetDepth",
    noun: "average depth of target, in yards, that season",
    positions: PASS_CATCHER_POSITIONS,
    get: (v) => v.targetDepth,
    formatValue: formatOneDecimal,
    shortLabel: "target depth",
  },
  {
    id: "snapShare",
    noun: "share of his team's offensive snaps that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.snapShare,
    formatValue: formatPercent,
    shortLabel: "snap share",
  },
  {
    id: "incomingCoachTenureSeasons",
    // Reworded (fix round): the ORIGINAL "team's incoming play-caller's seasons of tenure with that
    // team" read fine against the neutral "is in the top N% of {plural}" template `renderClaim`
    // still uses, but reads clunky once `renderSignedClaim` states an actual value ("... seasons of
    // tenure with that team is 3 or more") — moving "in seasons" to a trailing appositive fixes it
    // ("... tenure with that team, in seasons, is 3 or more"). No test pins the old wording verbatim
    // (`templates.test.ts`'s exact-string `renderClaim` assertions use `touches`/`targetShare`/`age`
    // only), so this reword is safe for both renderers.
    noun: "team's incoming play-caller's tenure with that team, in seasons,",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.incomingCoachTenureSeasons,
    formatValue: formatWhole,
    shortLabel: "incoming coach's tenure",
  },
  {
    id: "incomingCoachPriorPassRateOverExpected",
    noun: "team's incoming play-caller's own pass rate over expected at his previous teams",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.incomingCoachPriorPassRateOverExpected,
    formatValue: formatOneDecimal,
    shortLabel: "incoming coach's prior pass rate",
  },
  {
    id: "experienceYear",
    // Reworded (fix round): the ORIGINAL "number of seasons in the league, counting that season
    // itself" produced a comma splice once `renderSignedClaim` appended "is 8 or more" right after
    // the internal comma clause with no comma of its own — "...counting that season itself is 8 or
    // more" reads as a run-on. Parenthesizing the aside removes the internal comma entirely, so no
    // splice is possible regardless of what follows.
    noun: "number of seasons in the league (counting that season itself)",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.experienceYear,
    formatValue: formatWhole,
    shortLabel: "experience",
  },
  {
    id: "teamPaceSecondsPerPlay",
    noun: "team's own seconds per offensive play that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.teamPaceSecondsPerPlay,
    formatValue: formatOneDecimal,
    shortLabel: "team pace",
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

/** The sign-committed outcome clause `renderSignedClaim` closes a claim with, once a candidate's
 *  train-window effect sign is known — see that function's own docblock for why this is a SEPARATE
 *  clause from `OUTCOME_CLAUSE` rather than a template `renderClaim` fills in: the generator itself
 *  never knows a sign, only Task 7's measurement does. */
const SIGNED_OUTCOME_CLAUSE: Readonly<Record<-1 | 1, string>> = {
  [-1]: "loses points per game the following season.",
  [1]: "gains points per game the following season.",
};

/** The shared, sign-agnostic half of a rendered claim: the article, the position noun, and the
 *  clause's own English — `renderClaim` is the only caller left (its own quantile-percent
 *  `clauseText`); `renderSignedClaim` builds its sentence from `signedClauseText` instead, see that
 *  function's own docblock for why the two diverge. */
function claimIntro(parts: ClaimParts): string {
  const singular = POSITION_SINGULAR[parts.position];
  const article = /^[aeiou]/i.test(singular) ? "An" : "A";
  return `${article} ${singular} whose ${clauseText(parts.clause, parts.position)}`;
}

/**
 * THE ONE TESTED RENDERER. Mechanical end to end: every word is either a fixed template fragment or
 * a `QUANTITY_DEFS` noun, never prose written per candidate. No em-dashes, matching every other
 * user-facing string in this engine.
 */
export function renderClaim(parts: ClaimParts): string {
  return `${claimIntro(parts)} ${OUTCOME_CLAUSE}`;
}

/** Looks up ONE clause's actual committed threshold — never a quantile PERCENTAGE, the real number
 *  `quantiles` (almost always the committed `DISCOVERY_QUANTILES`) fitted for this exact
 *  (quantity, position, level) triple. Throws rather than guessing: a candidate whose own clause
 *  names a triple missing from `quantiles` means the candidate and the table it claims to be drawn
 *  from have drifted apart — a population-builder bug, not a renderable gap. */
function thresholdValueFor(quantiles: QuantileTable, position: LawPosition, quantityId: QuantityId, level: QuantileLevel): number {
  const value = quantiles[quantityId]?.[position]?.[level];
  if (value === undefined) {
    throw new Error(
      `renderSignedClaim: no committed quantile for ${quantityId}/${position}/${level} — the quantile table and this candidate's own clause have drifted apart.`,
    );
  }
  return value;
}

/**
 * `clauseText`'s VALUE-COMMITTED sibling (fix round, 2026-08-31 — replaces an earlier version of
 * `renderSignedClaim` that reused `clauseText`'s own "top N% of {plural}" wording verbatim, the same
 * wording `renderClaim` still uses BEFORE a candidate is measured). A committed law's claim states
 * the ACTUAL threshold the discovery quantile table fitted — "129 or more" — never a re-stated
 * percentage a reader cannot check against anything: the quantile table is itself committed
 * (`quantiles.ts`), so rendering its own numbers is mechanical, not a hand-authored translation.
 */
function signedClauseText(clause: Clause, position: LawPosition, quantiles: QuantileTable): string {
  switch (clause.kind) {
    case "threshold": {
      const def = quantityDef(clause.quantityId);
      const value = thresholdValueFor(quantiles, position, clause.quantityId, clause.quantileLevel);
      return `${def.noun} is ${def.formatValue(value)} or more`;
    }
    case "delta": {
      const def = quantityDef(clause.quantityId);
      const value = thresholdValueFor(quantiles, position, clause.quantityId, clause.quantileLevel);
      const formatted = def.formatValue(value);
      return clause.direction === "rose_into"
        ? `${def.noun} rose to ${formatted} or more after being below that mark the season before`
        : `${def.noun} fell below ${formatted} after being at or above that mark the season before`;
    }
    case "and":
      return `${signedClauseText(clause.left, position, quantiles)} and whose ${signedClauseText(clause.right, position, quantiles)}`;
  }
}

/** `clauseNouns`'s only use is `renderTitle`'s mechanical heading — the SHORT label per quantity in
 *  the clause, position-independent, never the full sentence-shaped noun `clauseText`/
 *  `signedClauseText` use. */
function clauseShortLabels(clause: Clause): readonly string[] {
  switch (clause.kind) {
    case "threshold":
    case "delta":
      return [quantityDef(clause.quantityId).shortLabel];
    case "and":
      return [...clauseShortLabels(clause.left), ...clauseShortLabels(clause.right)];
  }
}

/**
 * A short, MECHANICAL title for a discovered candidate's claim — position, plus its quantity/quantities'
 * own short labels, joined with "+" for an AND clause. Never a full sentence and never hand-authored
 * per candidate: this is `/player-laws`'s discovered-section heading, playing the same role a tribal
 * law's own hand-written name ("The workload cliff") plays for `splitClaim`'s colon-split — see
 * `renderSignedClaim`'s own docblock for how the two compose into one `claim` string.
 */
export function renderTitle(parts: ClaimParts): string {
  const singular = POSITION_SINGULAR[parts.position];
  const capitalized = singular.charAt(0).toUpperCase() + singular.slice(1);
  return `${capitalized} ${clauseShortLabels(parts.clause).join(" + ")}`;
}

/**
 * `renderClaim`'s sign-committed sibling — Task 7 (`discovery/measure.ts`) calls this once a BH
 * survivor's train-window effect sign is known, with the SAME committed `quantiles` table
 * (`DISCOVERY_QUANTILES`) the candidate was generated from, so `discovered.json`'s own claim reads
 * "gains"/"loses" points AND the actual committed threshold value, never the neutral quantile-percent
 * text `renderClaim` still carries for an unmeasured candidate.
 *
 * THE RETURNED STRING IS "Title: sentence", the identical shape every tribal `LawSpec.claim` already
 * has (`populations.ts`'s hand-authored "The workload cliff: a running back who..."). `/player-laws`'s
 * `splitClaim` colon-splits EITHER kind without knowing which it has — see that function's own
 * docblock, which was written expecting "a seventh law slots in with no new prose to write"; a
 * discovered law is exactly that seventh (and eighth, and so on) law, and composing the title in HERE
 * rather than teaching the page a second claim shape is what keeps that promise. `renderTitle` supplies
 * the title half; nothing here is prose written per candidate, and no em-dash appears in either half.
 */
export function renderSignedClaim(parts: ClaimParts, sign: -1 | 1, quantiles: QuantileTable): string {
  const singular = POSITION_SINGULAR[parts.position];
  const article = /^[aeiou]/i.test(singular) ? "An" : "A";
  const sentence = `${article} ${singular} whose ${signedClauseText(parts.clause, parts.position, quantiles)} ${SIGNED_OUTCOME_CLAUSE[sign]}`;
  return `${renderTitle(parts)}: ${sentence}`;
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
