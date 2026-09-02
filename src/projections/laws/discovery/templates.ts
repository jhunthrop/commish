import type { DiscoveryQuantityValues } from "../discovery-facts";
import type { LawPosition } from "../populations";
import type { PrimaryQuantityUnit } from "../types";

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

/**
 * THE HIGH BAND — a quantity at or ABOVE its position's quantile mark. The original three levels,
 * unchanged in value and in declared order, so every id and every committed threshold they name
 * stays byte-stable.
 */
export const HIGH_QUANTILE_LEVELS = [0.7, 0.8, 0.9] as const;

/**
 * THE LOW BAND (Task 2, the discovery-expansion plan) — a quantity at or BELOW its position's
 * quantile mark, the exact mirror of the high band rather than a second, differently-shaped family.
 *
 * WHY THE LOW SIDE EXISTS AT ALL. Every candidate the generator could state until now was a claim
 * about a STANDOUT: the top 30%, 20% or 10% of a position on some quantity. A whole class of
 * hypotheses is unsayable in that grammar, and the founder's own collapse case is the plainest of
 * them: a skill player on a team the market has written off. "His team's Vegas win total is in the
 * BOTTOM 20% of the league" is not the negation of any high-side candidate (the complement of the
 * top 20% is the other EIGHTY percent, which is not a band anybody could act on), so the low side is
 * genuinely new expressive power, not a restatement.
 *
 * MIRRORED, NOT INVENTED: 0.1/0.2/0.3 are the same three distances from the extreme that
 * 0.9/0.8/0.7 are, so a low-side candidate's population is the same SIZE as its high-side twin's,
 * which is what keeps the two halves of the family comparable under Benjamini-Hochberg rather than
 * one half being systematically thinner and therefore systematically less testable.
 */
export const LOW_QUANTILE_LEVELS = [0.1, 0.2, 0.3] as const;

/**
 * Every level, LOW FIRST then HIGH, each half ascending. The order is load-bearing twice over:
 * `computeQuantileTable` and the fit script serialize a quantity's thresholds in this order, and
 * `generate.ts` walks it when it builds candidates. Low-before-high keeps the whole list ascending,
 * which is how a reader checks a serialized row at a glance.
 */
export const QUANTILE_LEVELS = [...LOW_QUANTILE_LEVELS, ...HIGH_QUANTILE_LEVELS] as const;
export type QuantileLevel = (typeof QUANTILE_LEVELS)[number];

/**
 * WHICH BAND A LEVEL NAMES, derived from the level itself rather than stored a second time on every
 * clause. A `ThresholdClause` carries a level and nothing else, exactly as it did before this task,
 * so no invalid (level, side) pair is representable and no existing candidate id changes shape.
 */
export type QuantileSide = "low" | "high";

const LOW_LEVEL_SET: ReadonlySet<number> = new Set(LOW_QUANTILE_LEVELS);

/** The band a level belongs to. Total over `QuantileLevel` by construction: a level is in
 *  `LOW_QUANTILE_LEVELS` or it is not, and the two arrays above are the whole of `QUANTILE_LEVELS`. */
export function sideOf(level: QuantileLevel): QuantileSide {
  return LOW_LEVEL_SET.has(level) ? "low" : "high";
}

/**
 * THE SHORT TAG A LEVEL IS NAMED BY — in a candidate id (`generate.ts`'s `idFor`), in the fit
 * script's console table, and anywhere else a level needs a filename-safe token. ONE map, here, next
 * to the levels themselves: the id fragment and the printed label were briefly two hand-maintained
 * copies of the same fact, which is how a widened level list ends up half-renamed.
 *
 * The three high-side tags are byte-identical to what they always were, which is what keeps every
 * candidate id that existed before the low band stable.
 */
export const QUANTILE_TAG: Readonly<Record<QuantileLevel, string>> = {
  0.1: "q10",
  0.2: "q20",
  0.3: "q30",
  0.7: "q70",
  0.8: "q80",
  0.9: "q90",
};

/**
 * The percentile label a quantile LEVEL reads as in plain words. On the HIGH side, crossing the 0.8
 * quantile puts a player in the top 20% of his position; on the LOW side, sitting at or under the
 * 0.2 quantile puts him in the bottom 20%. The label is the DISTANCE FROM THE NEARER EXTREME either
 * way, which is why 0.2 and 0.8 share "20%" — the word before it ("top" or "bottom", supplied by
 * `clauseText` from `sideOf`) is what tells the two apart.
 *
 * APPROXIMATE UNDER TIES, on both sides and always has been: an interpolated quantile does not
 * partition a population with mass at a single value into exactly that percentage. `renderClaim`,
 * the only renderer that speaks percentages, is the PRE-measurement one; every committed law's claim
 * goes through `renderSignedClaim`, which states the real fitted number instead.
 */
const QUANTILE_PERCENT_LABEL: Readonly<Record<QuantileLevel, string>> = {
  0.1: "10%",
  0.2: "20%",
  0.3: "30%",
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
   *  `renderSignedClaim` drops into "... is {formatValue(value, rounding)} or more". The rounding
   *  direction is the CALLER's, never the quantity's: see `ThresholdRounding`. */
  readonly formatValue: (value: number, rounding: ThresholdRounding) => string;
  /** A two-or-three-word label for `renderTitle`'s mechanical heading — never a full sentence, never
   *  hand-authored prose about a specific candidate. */
  readonly shortLabel: string;
  /** Which of `PrimaryQuantityUnit`'s four plain-rounded shapes a MAGNITUDE (a player's own value)
   *  of this quantity formats as — persisted onto a discovered `Law` (`registry.ts`'s
   *  `primaryQuantityUnit`, written by `discovery/measure.ts`) so `ReasonChip` can format a
   *  magnitude without importing this module. Deliberately independent of `formatValue`'s own
   *  ceiling rounding, which is for a THRESHOLD's committed number, not a player's fact — see
   *  `PrimaryQuantityUnit`'s own docblock (`../types.ts`). */
  readonly magnitudeUnit: PrimaryQuantityUnit;
  /**
   * Whether the YEAR-OVER-YEAR delta template (`generate.ts`'s `deltaConditionOf`: did this quantity
   * cross its own quantile mark between season N-1 and season N) means anything for this quantity.
   *
   * `true` for every quantity in the registry but one, and the exception is the point of the flag:
   * `incomingTeamWinTotalDelta` IS ALREADY A DELTA (a win total minus a record), so a YoY template
   * over it asks whether a first difference crossed a threshold that a second difference already
   * crossed the year before — a second-order quantity nobody could state in plain words, let alone
   * act on, and six candidates per position of pure multiple-comparisons cost for it. Excluded here,
   * at the quantity, rather than special-cased inside the generator: the generator's three template
   * families stay mechanical, and a future quantity that is itself a difference declares the same
   * fact about itself in the same place.
   *
   * THRESHOLD and AND are unaffected — "the market says this team falls by three wins or more" is a
   * perfectly ordinary threshold, and it is the shape the founder's Achane case actually has.
   */
  readonly supportsYearOverYearDelta: boolean;
  /**
   * WHETHER THIS QUANTITY *IS* THE MATCHED DESIGN'S OWN MATCH KEY, and therefore cannot carry a
   * LEVEL template (threshold, and an AND built from thresholds) without the matching itself
   * manufacturing the effect. `true` for exactly one quantity, `pointsPerGame`, and the flag exists
   * so the exclusion is a declared property of that quantity rather than an id special-cased inside
   * `generate.ts`, exactly as `supportsYearOverYearDelta` above already is.
   *
   * THE PROOF, not an intuition. `discovery/measure.ts`'s `populationForCandidate` sets
   * `matchKey: row.pointsPerGame`, and `harness.ts`'s `matchedPairs` pairs each condition row with
   * the closest UNCLAIMED control whose `matchKey` is within `POINTS_PER_GAME_CALIPER` (2 points).
   * `DiscoverySeasonRow.pointsPerGame` is `factsForSeason`'s own season-N read at
   * `schedulePublishedAsOf(season + 1)` and this quantity is `discoveryFactsForSeason`'s season-N
   * read at the identical gate, so the two are not merely correlated: they are THE SAME NUMBER.
   * Give a threshold candidate the clause `pointsPerGame >= T` and every condition row has
   * `matchKey >= T` while every control row has `matchKey < T`, so
   * `condition.matchKey > control.matchKey` for EVERY pair the matcher can build, with no exception
   * and in one direction only. The outcome being differenced is
   * `nextPointsPerGame - pointsPerGame`, which mean-reverts in `pointsPerGame`; a systematically
   * higher-scoring condition arm therefore carries a systematically more negative difference than
   * its controls before the candidate's own condition has said anything at all. Every low-side
   * threshold on the quantity has the same defect with the sign flipped. That is not a weak
   * candidate, it is a candidate whose measured effect is a function of the matcher.
   *
   * A SECOND, INDEPENDENT REASON THE CLAIM WOULD BE FALSE AS WRITTEN. The caliper also DROPS every
   * condition row with no control within two points, which for a level condition on the match key is
   * every player more than two points clear of the threshold. The surviving population is a
   * caliper-wide sliver either side of T, so a rendered claim promising "a running back whose points
   * per game is 14.0 or more" would be evidenced by running backs scoring 14 to 16 against running
   * backs scoring 12 to 14. The words and the measurement would not be about the same players.
   *
   * WHAT IS KEPT, AND WHY IT IS SOUND. The DELTA template over this quantity is generated normally,
   * because neither defect applies to it: a delta condition is a CROSSING between seasons N-1 and N,
   * so the control pool provably holds rows on BOTH sides of T (a player who was already above the
   * mark last season and still is fails "rose into it" while sitting above T), the one-sided
   * inequality above does not hold, and the caliper then does exactly the job it was built for —
   * it pairs a player who arrived at this level of production with a player already at it. That is a
   * real, sayable, measurable question, and it is the production-conditional shape this task was
   * asked for.
   */
  readonly isMatchKeyQuantity: boolean;

  /**
   * WHETHER THIS QUANTITY IS THE MATCH KEY'S OWN RELIABILITY — the sample size the match key is
   * measured over — and therefore cannot carry a LEVEL template for a SECOND, INDEPENDENT reason
   * from the one above. `true` for exactly one quantity, `gamesPlayed`.
   *
   * ADDED 2026-09-01 BY ULTRACODE REVIEW RULING, after twelve `gamesPlayed`-conditioned laws (seven
   * thresholds, five conjunctions) came back confirmed in a regeneration and could not be
   * distinguished from this artifact. The flag is separate from `isMatchKeyQuantity` rather than
   * folded into it because the two defects are genuinely different and a reader deserves to know
   * WHICH one a quantity is excluded for: `pointsPerGame` IS the match key, `gamesPlayed` is the
   * DENOMINATOR the match key is divided by.
   *
   * THE ARGUMENT. The match key is points per game, i.e. season points over `gamesPlayed`, and the
   * outcome being differenced is `nextPointsPerGame - pointsPerGame`. The caliper equalises the
   * OBSERVED value of that ratio between the two arms to within two points. It cannot equalise the
   * PRECISION of the two observations, because precision is a function of the denominator and the
   * denominator is exactly what the candidate is conditioning on. At equal observed points per game,
   * a player scored in 3 games carries a far noisier estimate of his own true rate than a player
   * scored in 15, so his observed value sits further from his true value in expectation, and his
   * next season regresses toward that true value harder and more often. The measured effect is
   * regression to the mean sorted by measurement error, and it appears whether or not the claim is
   * true.
   *
   * WHY MATCHING DOES NOT CURE IT, WHICH IS THE PART THAT LOOKS WRONG UNTIL IT IS TRACED. Equal
   * observed points per game is the artifact's PRECONDITION, not its cure. Two players at 9.0 points
   * per game, one over 3 games and one over 15, are not two draws from the same distribution that
   * happen to agree; they are one precise observation and one imprecise one that agree BY SELECTION.
   * The caliper is what puts them in the same pair, so tightening it strengthens the artifact rather
   * than weakening it.
   *
   * WHY FOLD REPLICATION DOES NOT RESCUE IT EITHER, which is why these twelve were confirmed rather
   * than weak. `verdictForDiscoveredLaw` requires every replication fold to agree in direction with
   * the full-window effect. An artifact of the estimator is STABLE across seasons in exactly the way
   * a real effect is: the noisier arm regresses harder in 2021, 2022 and 2023 alike, because the
   * arithmetic that produces it does not vary by season. Unanimous fold agreement is evidence
   * against a fluke and is no evidence at all against a mechanism.
   *
   * THE PROBE THAT SETTLED IT, rather than the argument alone: within the confirmed
   * `gamesPlayed` candidates the effect concentrates in pairs with a LARGE games gap between the
   * arms, flips sign in pairs with a small one, and scales with distance above the population mean.
   * A claim about durability would not have that shape; a reliability artifact has exactly it.
   *
   * WHAT IS KEPT. The DELTA template, for the same reason `isMatchKeyQuantity` keeps it: a crossing
   * condition places rows on BOTH sides of the mark in the control pool, so the condition arm is not
   * systematically the low-precision arm, and the question the crossing asks (a player whose
   * availability collapsed or recovered between seasons, against a player already there) is a real
   * one the arithmetic does not answer for free.
   */
  readonly isMatchKeyReliabilityQuantity: boolean;
}

/**
 * THE ONE GATE `generate.ts` READS before emitting a threshold candidate or admitting a single into
 * the AND family. Two separately-named, separately-argued exclusions, one predicate, so the generator
 * never branches on an id and a future third reason has an obvious place to go.
 *
 * DELTA candidates are deliberately NOT gated by this: both exclusions are arguments about LEVEL
 * conditions specifically, and both docblocks above set out why the crossing template survives each.
 */
export function emitsLevelConditions(def: QuantityDef): boolean {
  return !def.isMatchKeyQuantity && !def.isMatchKeyReliabilityQuantity;
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
/**
 * ROUNDING DIRECTION (fix round 2, NEW-3; extended to the low band by Task 2) — every `formatValue`
 * below rounds AWAY from the population the clause admits, never toward the nearer number, so the
 * DISPLAYED number is never a looser predicate than the real one.
 *
 * HIGH BAND, the original rule. The clause is "value >= threshold"; rounding DOWN (or to nearest)
 * can understate the real threshold — a touches threshold of `237.3` rounded to nearest gives "237
 * or more", but a player with EXACTLY 237 touches does NOT satisfy `237 >= 237.3`, so the rendered
 * claim would falsely include him. Rounding toward the CEILING makes the displayed number itself
 * `>= threshold`, and "displayed value or more" is never a superset of "the real threshold or more".
 *
 * LOW BAND, the mirror. The clause is "value <= threshold", and there the ceiling is the DANGEROUS
 * direction for exactly the same reason read backwards: a win-total threshold of `6.4` displayed as
 * "6.5 or less" would admit a team at 6.5 that `6.5 <= 6.4` rejects. The floor is the safe
 * direction, so a low clause renders `roundAtDecimals(value, decimals, "floor")`.
 *
 * WHICH DIRECTION IS THE CALLER'S CALL, never the quantity's — hence the parameter. `sideOf` the
 * clause's own level picks it (`roundingForSide` below), so a quantity cannot carry a stale opinion
 * about a band it is being rendered in. `templates.test.ts`'s property test checks BOTH directions
 * against every real committed quantile the discovery table carries.
 *
 * `roundAtDecimals` rounds the scaled value to 6 decimal places BEFORE the ceiling or floor, to
 * strip the floating-point representation noise a raw `value * 10**decimals` can carry (e.g.
 * `0.19 * 1000` can compute as `190.00000000000003`, which would otherwise ceiling up to 191
 * instead of staying at 190 for a threshold that already sits exactly on a displayable boundary) —
 * a purely cosmetic tightness concern, never a correctness one either way, but worth not
 * introducing for free.
 */
export type ThresholdRounding = "ceil" | "floor";

/** The rounding direction a band's own comparison needs — see the section docblock above. */
export function roundingForSide(side: QuantileSide): ThresholdRounding {
  return side === "high" ? "ceil" : "floor";
}

function roundAtDecimals(value: number, decimals: number, rounding: ThresholdRounding): number {
  const factor = 10 ** decimals;
  const scaled = Math.round(value * factor * 1e6) / 1e6;
  return (rounding === "ceil" ? Math.ceil(scaled) : Math.floor(scaled)) / factor;
}

/** Whole-number formatting — touches, tenure seasons, experience years, games, draft pick: no
 *  fractional value in the underlying quantity is ever meaningful to a reader, even though a
 *  quantile interpolation can land on one (e.g. `237.29999999999995`, which must display as `238`
 *  on the high side and `237` on the low side — see this section's own docblock). */
const formatWhole = (value: number, rounding: ThresholdRounding): string => `${roundAtDecimals(value, 0, rounding)}`;
/** One-decimal formatting — target depth, pace, incoming coach's prior pass rate, points per game:
 *  genuinely continuous quantities where one decimal is precise enough that a second would not
 *  change what a reader could act on, unlike age (see `formatAgeYears` below) or a percent share. */
const formatOneDecimal = (value: number, rounding: ThresholdRounding): string => roundAtDecimals(value, 1, rounding).toFixed(1);
/** Age, specifically — TWO decimals (fix round 2: one extra beyond the general one-decimal case),
 *  because age is the single most load-bearing continuous quantity across the confirmed discovered
 *  laws today, and a whole extra digit of precision costs nothing for a reader to skim past. */
const formatAgeYears = (value: number, rounding: ThresholdRounding): string => roundAtDecimals(value, 2, rounding).toFixed(2);
/** Percentage formatting for a 0..1 share/rate, ONE decimal (fix round 2: was whole-percent
 *  rounded to nearest, which could understate a threshold like `19.489%` as "19%" — a player at
 *  19.2% would then misread the claim as satisfied when the real predicate needs 19.489%). */
const formatPercent = (value: number, rounding: ThresholdRounding): string =>
  `${roundAtDecimals(value * 100, 1, rounding).toFixed(1)}%`;

export const QUANTITY_DEFS: readonly QuantityDef[] = [
  {
    id: "touches",
    noun: "combined carries and receptions that season",
    positions: ["RB"],
    get: (v) => v.touches,
    formatValue: formatWhole,
    shortLabel: "carries and receptions",
    magnitudeUnit: "whole",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  {
    id: "age",
    noun: "age at that season's opener",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.age,
    formatValue: formatAgeYears,
    shortLabel: "age",
    magnitudeUnit: "two_decimal",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  {
    id: "targetShare",
    noun: "share of his team's targets that season",
    positions: RECEIVING_POSITIONS,
    get: (v) => v.targetShare,
    formatValue: formatPercent,
    shortLabel: "target share",
    magnitudeUnit: "percent",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  {
    id: "touchdownPointsShare",
    noun: "share of his own fantasy points that came from touchdowns that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.touchdownPointsShare,
    formatValue: formatPercent,
    shortLabel: "touchdown-points share",
    magnitudeUnit: "percent",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  {
    id: "redZoneTouchShare",
    noun: "share of his own carries and targets that came in the red zone that season",
    positions: RECEIVING_POSITIONS,
    get: (v) => v.redZoneTouchShare,
    formatValue: formatPercent,
    shortLabel: "red-zone touch share",
    magnitudeUnit: "percent",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  {
    id: "targetDepth",
    noun: "average depth of target, in yards, that season",
    positions: PASS_CATCHER_POSITIONS,
    get: (v) => v.targetDepth,
    formatValue: formatOneDecimal,
    shortLabel: "target depth",
    magnitudeUnit: "one_decimal",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  {
    id: "snapShare",
    noun: "share of his team's offensive snaps that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.snapShare,
    formatValue: formatPercent,
    shortLabel: "snap share",
    magnitudeUnit: "percent",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
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
    magnitudeUnit: "whole",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  {
    id: "incomingCoachPriorPassRateOverExpected",
    noun: "team's incoming play-caller's own pass rate over expected at his previous teams",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.incomingCoachPriorPassRateOverExpected,
    formatValue: formatOneDecimal,
    shortLabel: "incoming coach's prior pass rate",
    magnitudeUnit: "one_decimal",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
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
    magnitudeUnit: "whole",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  {
    id: "teamPaceSecondsPerPlay",
    noun: "team's own seconds per offensive play that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.teamPaceSecondsPerPlay,
    formatValue: formatOneDecimal,
    shortLabel: "team pace",
    magnitudeUnit: "one_decimal",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  /**
   * THE TWO TEAM-MARKET QUANTITIES (Task 3, the vegas-laws plan) — the market's own preseason
   * judgment of a TEAM, which nothing else in this vocabulary carries. Appended at the END of the
   * registry deliberately: `computeQuantileTable` walks this array in order and the fit script
   * serializes the table in that order, so appending keeps the regenerated `quantiles.ts` a purely
   * additive diff, which is what lets a reader see at a glance that no existing quantity's committed
   * thresholds moved. Candidate ids are unaffected either way (`generateCandidatesFrom` sorts them
   * canonically before returning).
   *
   * ALL FOUR POSITIONS, like the incoming-coach pair they mirror: a team's expected quality is a fact
   * about the offence every skill player is in, not about one position group.
   */
  {
    id: "incomingTeamWinTotal",
    noun: "team's Vegas win total for the season ahead",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.incomingTeamWinTotal,
    formatValue: formatOneDecimal,
    shortLabel: "incoming team win total",
    magnitudeUnit: "one_decimal",
    // A win total genuinely can rise into or fall out of the top band year over year, and a team the
    // market newly believes in is an ordinary, sayable claim. Kept.
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  {
    id: "incomingTeamWinTotalDelta",
    noun: "team's Vegas win total for the season ahead minus its actual wins in the season just played",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.incomingTeamWinTotalDelta,
    formatValue: formatOneDecimal,
    shortLabel: "win total minus prior wins",
    magnitudeUnit: "one_decimal",
    // The ONE exclusion in the registry — see `supportsYearOverYearDelta`'s own docblock: this
    // quantity is itself a difference, so a year-over-year template over it is a second difference.
    supportsYearOverYearDelta: false,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  /**
   * THE FOUR VOCABULARY ADDITIONS (Task 2, the discovery-expansion plan) plus the one
   * production-conditional quantity, all appended at the END of the registry for the reason the
   * team-market pair above states: `computeQuantileTable` walks this array in order and the fit
   * script serializes the table in that order, so appending keeps a regenerated `quantiles.ts` a
   * purely additive diff and no existing quantity's committed thresholds move.
   *
   * PICKED ON COVERAGE AND DISTINCTNESS, from facts the builder can already reach. Every one is
   * computed inside `discoveryQuantitiesForSeason` from a read that module ALREADY performs (the
   * play-by-play touch aggregate, the season scoring entry, the preseason roster row); not one adds
   * a store round trip, an ingestion, or a metric.
   */
  {
    id: "insideTenTouchShare",
    noun: "share of his own carries and targets that came inside the ten",
    positions: RECEIVING_POSITIONS,
    get: (v) => v.insideTenTouchShare,
    formatValue: formatPercent,
    shortLabel: "inside-ten touch share",
    magnitudeUnit: "percent",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  {
    id: "teamAirYardsShare",
    noun: "share of his team's air yards that season",
    positions: RECEIVING_POSITIONS,
    get: (v) => v.teamAirYardsShare,
    formatValue: formatPercent,
    shortLabel: "air-yards share",
    magnitudeUnit: "percent",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  /**
   * AVAILABILITY — how many games this season actually scored him.
   *
   * DELTA ONLY, and NOT for the reason `pointsPerGame` below is. This quantity is not the match key;
   * it is the match key's DENOMINATOR, which makes it the reliability of the number the matcher pairs
   * on. A level condition over it therefore sorts pairs by measurement precision and reads regression
   * to the mean as an effect, whatever the claim says. The full argument, the reason the caliper
   * cannot cure it, the reason unanimous fold agreement is not evidence against it, and the probe
   * that settled it are all in `QuantityDef.isMatchKeyReliabilityQuantity`'s docblock above;
   * `generate.ts` reads the flag through `emitsLevelConditions`, never this id.
   *
   * The crossing template survives and is the honest version of the availability question: a player
   * whose availability collapsed or recovered BETWEEN seasons, measured against a player already
   * there.
   */
  {
    id: "gamesPlayed",
    noun: "number of games he was scored in that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.gamesPlayed,
    formatValue: formatWhole,
    shortLabel: "games played",
    magnitudeUnit: "whole",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: true,
  },
  {
    id: "draftPick",
    // The noun carries the direction, because the number runs BACKWARDS against every other quantity
    // in this registry: a bigger draft pick is a worse one. Without the appositive, "a wide receiver
    // whose overall draft pick is in the top 10%" reads as a compliment and means the opposite.
    noun: "overall draft pick, counting a later pick as a larger number,",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.draftPick,
    formatValue: formatWhole,
    shortLabel: "draft pick",
    magnitudeUnit: "whole",
    // The SECOND exclusion in the registry, and a different reason from the first: a draft pick is
    // a career constant, so it cannot cross a quantile mark between season N-1 and season N at all.
    // Every year-over-year candidate over it would be identically false for every player in every
    // season, which is not a weak candidate but a non-candidate: six ids per position of pure
    // multiple-comparisons cost buying a question with no possible affirmative answer.
    supportsYearOverYearDelta: false,
    isMatchKeyQuantity: false,
    isMatchKeyReliabilityQuantity: false,
  },
  /**
   * THE PRODUCTION CONDITIONAL — season N's own points per game, as a CONDITION on season N with the
   * outcome still read at season N+1, the same one-season offset the matched design already applies
   * to every other quantity here.
   *
   * DELTA ONLY. This quantity is the matched design's own match key, which makes a LEVEL template
   * over it unmeasurable rather than merely weak — the whole argument, with its proof, is
   * `QuantityDef.isMatchKeyQuantity`'s docblock above, and `generate.ts` reads the flag rather than
   * this id. What survives is the crossing template, which asks the question worth asking: a player
   * who ROSE into this level of production, measured against a player already at it.
   */
  {
    id: "pointsPerGame",
    noun: "points per game that season",
    positions: ALL_SKILL_POSITIONS,
    get: (v) => v.pointsPerGame,
    formatValue: formatOneDecimal,
    shortLabel: "points per game",
    magnitudeUnit: "one_decimal",
    supportsYearOverYearDelta: true,
    isMatchKeyQuantity: true,
    isMatchKeyReliabilityQuantity: false,
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

/** A single threshold-crossing clause: the quantity is at or above its position's quantile mark on
 *  the HIGH band, at or below it on the LOW band. `sideOf(quantileLevel)` is which, always. */
export interface ThresholdClause {
  readonly kind: "threshold";
  readonly quantityId: QuantityId;
  readonly quantileLevel: QuantileLevel;
}

/**
 * A year-over-year clause: the quantity crossed the same quantile mark from the season before.
 *
 * `direction` NAMES THE VALUE'S OWN MOTION, never the band's — `rose_into` is always "the value went
 * up across the mark", `fell_out_of` always "the value went down across it". On the HIGH band those
 * two happen to read as entering and leaving the band, which is where the names come from and why
 * they are kept verbatim (every existing candidate id embeds them; renaming would churn the id of
 * every measured law for no gain). On the LOW band the SAME motion means the opposite membership: a
 * value that fell across the mark has fallen INTO the bottom band, and one that rose across it has
 * climbed OUT of it. `clauseText` and `signedClauseText` say which of the two a reader is looking at,
 * in words, from `sideOf(quantileLevel)`.
 */
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

/** "top 20% of wide receivers" or "bottom 20% of wide receivers" — the band a level names, in the
 *  words every unmeasured claim states it with. */
function bandText(level: QuantileLevel, position: LawPosition): string {
  const edge = sideOf(level) === "high" ? "top" : "bottom";
  return `${edge} ${QUANTILE_PERCENT_LABEL[level]} of ${POSITION_PLURAL[position]}`;
}

function clauseText(clause: Clause, position: LawPosition): string {
  switch (clause.kind) {
    case "threshold":
      return `${quantityDef(clause.quantityId).noun} is in the ${bandText(clause.quantileLevel, position)}`;
    case "delta": {
      const noun = quantityDef(clause.quantityId).noun;
      const band = bandText(clause.quantileLevel, position);
      // The VERB follows the value's own motion and the PREPOSITION follows what that motion did to
      // its band membership — see `DeltaClause`'s own docblock. On the high band a rise enters the
      // band and a fall leaves it; on the low band a fall enters it and a rise leaves it.
      const isHigh = sideOf(clause.quantileLevel) === "high";
      const entersBand = isHigh === (clause.direction === "rose_into");
      const verb = clause.direction === "rose_into" ? "climbed" : "fell";
      // Outside the high band is BELOW its mark; outside the low band is ABOVE its mark. The high-side
      // wording is byte-identical to what it was before the low band existed.
      const wasOutside = isHigh ? "below" : "above";
      return entersBand
        ? `${noun} ${verb} into the ${band} after being ${wasOutside} it the year before`
        : `${noun} ${verb} out of the ${band} after being in it the year before`;
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
      const side = sideOf(clause.quantileLevel);
      const value = thresholdValueFor(quantiles, position, clause.quantityId, clause.quantileLevel);
      const formatted = def.formatValue(value, roundingForSide(side));
      return `${def.noun} is ${formatted} ${side === "high" ? "or more" : "or less"}`;
    }
    case "delta": {
      const def = quantityDef(clause.quantityId);
      const side = sideOf(clause.quantileLevel);
      const value = thresholdValueFor(quantiles, position, clause.quantityId, clause.quantileLevel);
      // ONE rounding per clause, taken from the band, so a single fitted threshold never prints as
      // two different numbers inside one sentence. The band's own membership test is the half that
      // gets the safe direction ("at or above" on the high band, "at or below" on the low one),
      // which is the half a reader checks a player against.
      const formatted = def.formatValue(value, roundingForSide(side));
      if (side === "high") {
        return clause.direction === "rose_into"
          ? `${def.noun} rose to ${formatted} or more after being below that mark the season before`
          : `${def.noun} fell below ${formatted} after being at or above that mark the season before`;
      }
      return clause.direction === "fell_out_of"
        ? `${def.noun} fell to ${formatted} or less after being above that mark the season before`
        : `${def.noun} rose above ${formatted} after being at or below that mark the season before`;
    }
    case "and":
      return `${signedClauseText(clause.left, position, quantiles)} and whose ${signedClauseText(clause.right, position, quantiles)}`;
  }
}

/** Every quantity a clause reads, deduplicated — the DISCOVERY FAMILY a candidate belongs to,
 *  ignoring thresholds/quantile levels/direction entirely. `/player-laws`'s nesting collapse
 *  (NESTING RULING, fix round 2) uses this to detect two confirmed discovered laws sharing, or
 *  strictly nesting, the same quantities — see that page's own `groupIntoFamilies` docblock for the
 *  full rule (position must ALSO match; this function alone does not know about position). */
export function quantityIdsOf(clause: Clause): ReadonlySet<QuantityId> {
  switch (clause.kind) {
    case "threshold":
    case "delta":
      return new Set([clause.quantityId]);
    case "and":
      return new Set([...quantityIdsOf(clause.left), ...quantityIdsOf(clause.right)]);
  }
}

/**
 * THE PRIMARY QUANTITY A CLAUSE'S MAGNITUDE IS READ FROM (Task 8) — itself, for a single clause
 * (`threshold` or `delta`); the LEFT (structurally first) clause's own quantity, for an `and`. This is
 * the brief's own "AND laws use the primary quantity's value, defined as the first clause's quantity"
 * rule, written exactly once here so a live board (`laws/board-reasons.ts`'s
 * `magnitudeForDiscoveredLaw`) and a chip's own headline (`ReasonChip`'s `discoveredHeadline`) can
 * never read two different "which quantity is this number" answers for the same candidate.
 *
 * `generate.ts`'s own AND-pairing rule builds every AND from two THRESHOLD singles (never a nested
 * AND, never a delta half — see that module's own docblock), so `clause.left` is always itself a
 * `ThresholdClause` for every candidate this generator can produce today; the recursion below still
 * handles a hypothetical AND-of-AND correctly rather than assuming that shape.
 */
export function primaryQuantityIdOf(clause: Clause): QuantityId {
  return clause.kind === "and" ? primaryQuantityIdOf(clause.left) : clause.quantityId;
}

/** `primaryQuantityIdOf`'s own `QuantityDef` — the same id-to-def lookup `clauseText`/
 *  `signedClauseText` already do internally (`quantityDef`, private to this module), exposed here so
 *  a caller outside it can read a clause's primary quantity's `get`/`formatValue`/`shortLabel`
 *  without re-deriving the lookup a second place. Throws exactly like `quantityDef` itself would — a
 *  clause naming a `quantityId` absent from `QUANTITY_DEFS` is drift, not a renderable gap. */
export function primaryQuantityDefOf(clause: Clause): QuantityDef {
  return quantityDef(primaryQuantityIdOf(clause));
}

/** `clauseNouns`'s only use is `renderTitle`'s mechanical heading — the SHORT label PLUS the real
 *  committed threshold VALUE per quantity in the clause (fix round 2: `renderTitle` used to omit
 *  the value entirely, which meant two candidates sharing a quantity at two different quantile
 *  levels — "touchdown-points share >= 19%" and "...>= 23%" — rendered byte-identical headings;
 *  see `renderTitle`'s own docblock for why that specifically had to stop). */
function clauseShortLabelsWithValue(clause: Clause, position: LawPosition, quantiles: QuantileTable): readonly string[] {
  switch (clause.kind) {
    case "threshold":
    case "delta": {
      const def = quantityDef(clause.quantityId);
      const side = sideOf(clause.quantileLevel);
      const value = thresholdValueFor(quantiles, position, clause.quantityId, clause.quantileLevel);
      // The band's own comparison is carried into the heading too, because a bare "(9.0)" cannot tell
      // a reader whether the law is about teams at nine wins or more or nine wins or fewer, and a
      // low-side and a high-side candidate on one quantity can otherwise round to the same number.
      const formatted = def.formatValue(value, roundingForSide(side));
      return [`${def.shortLabel} (${side === "high" ? formatted : `${formatted} or less`})`];
    }
    case "and":
      return [
        ...clauseShortLabelsWithValue(clause.left, position, quantiles),
        ...clauseShortLabelsWithValue(clause.right, position, quantiles),
      ];
  }
}

/**
 * A short, MECHANICAL title for a discovered candidate's claim — position, plus its quantity/quantities'
 * own short labels AND their real committed threshold values (fix round 2 — see `clauseShortLabelsWithValue`'s
 * own docblock for why the value is no longer optional: without it, no two headings for the same
 * quantity at different quantile levels are guaranteed distinct, which both reads as a duplicate to a
 * person and breaks `/player-laws`'s nesting-collapse card, which lists nested variants BY this title).
 * Joined with "+" for an AND clause. Never a full sentence and never hand-authored per candidate: this
 * is `/player-laws`'s discovered-section heading, playing the same role a tribal law's own hand-written
 * name ("The workload cliff") plays for `splitClaim`'s colon-split — see `renderSignedClaim`'s own
 * docblock for how the two compose into one `claim` string.
 */
export function renderTitle(parts: ClaimParts, quantiles: QuantileTable): string {
  const singular = POSITION_SINGULAR[parts.position];
  const capitalized = singular.charAt(0).toUpperCase() + singular.slice(1);
  return `${capitalized} ${clauseShortLabelsWithValue(parts.clause, parts.position, quantiles).join(" + ")}`;
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
  return `${renderTitle(parts, quantiles)}: ${sentence}`;
}

/**
 * One quantity's fitted train-window thresholds, at the quantile levels this generator uses.
 *
 * PARTIAL PER LEVEL (Task 2), not merely per position. `computeQuantileTable` fills every level of
 * `QUANTILE_LEVELS` for any (quantity, position) that clears `MIN_QUANTILE_SAMPLE`, so a freshly
 * fitted table is never sparse at this depth — but the COMMITTED table is a snapshot of whatever
 * `QUANTILE_LEVELS` was on the day it was fitted, and this task widened that list without refitting
 * (the refit belongs to the regeneration event that also extends the measurement window). A
 * non-partial type here would have let `generate.ts` read `undefined` as a `number` and build
 * candidates whose threshold is `undefined`, whose condition `value >= undefined` is false for every
 * player alive, and whose ids would silently join the family as dead weight. `quantileCoverageGaps`
 * below reports exactly which triples a table is missing, so the gap is a number a script can print
 * rather than a silence.
 */
export type QuantileThresholds = Readonly<Partial<Record<QuantileLevel, number>>>;

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

/** One (quantity, position, level) triple a table does not carry a threshold for. */
export interface QuantileCoverageGap {
  readonly quantityId: QuantityId;
  readonly position: LawPosition;
  readonly level: QuantileLevel;
}

/**
 * EVERY LEVEL A TABLE IS MISSING for a (quantity, position) it otherwise covers — the visible half of
 * `QuantileThresholds`' partiality, so a widened `QUANTILE_LEVELS` against a table fitted before the
 * widening is a printable count instead of a family that silently fails to grow.
 *
 * A (quantity, position) the table has NO entry for at all is deliberately NOT reported: that is the
 * ordinary `MIN_QUANTILE_SAMPLE` outcome (a position with too few train-season observations to trust
 * a quantile), a decision the fit already made on purpose, not a stale-table gap. What this function
 * finds is the other case: a combination the table DOES cover, at some levels but not all of them.
 */
export function quantileCoverageGaps(quantiles: QuantileTable): readonly QuantileCoverageGap[] {
  const gaps: QuantileCoverageGap[] = [];
  for (const def of QUANTITY_DEFS) {
    for (const position of def.positions) {
      const thresholds = quantiles[def.id]?.[position];
      if (thresholds === undefined) continue;
      for (const level of QUANTILE_LEVELS) {
        if (thresholds[level] === undefined) gaps.push({ quantityId: def.id, position, level });
      }
    }
  }
  return gaps;
}
