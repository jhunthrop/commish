import type { Position, StatLine } from "@/domain/player";
import type { SeasonStatLine } from "../lines";
import { HISTORICAL_ROSTER_FLOOR } from "../nflverse/rosters";
import type { PlayerWeekUsage } from "../usage";

/**
 * LAYER 2: EFFICIENCY PRIORS — every rate regressed hard toward its role's mean, and touchdown
 * rate regressed hardest of all.
 *
 * The engine spec is blunt about why this layer exists and why it is small: opportunity is stable,
 * efficiency is mostly noise. A receiver's target share barely moves week to week; his catch rate
 * swings wildly. So the job here is not to predict efficiency well — nobody can — it is to avoid
 * being CONFIDENTLY WRONG about it, which is a different and achievable thing.
 *
 * TOUCHDOWN RATE IS THE ONE THAT MATTERS. Ten targets and two touchdowns reads as a 20% touchdown
 * rate and means almost nothing; ten targets and eighty yards means something real. A model that
 * treats those two rates alike carries a receiver's September luck into every week that follows,
 * looks confident, and is wrong by week six. That is the single most common way an amateur
 * projection embarrasses itself, so the regression constant for every touchdown rate is measured
 * separately and a test pins that all three exceed every other rate's.
 *
 * REGRESSION IS COUNTED IN OPPORTUNITIES, NOT IN GAMES. A back with two hundred carries and a back
 * with twenty are not equally known, and a constant expressed in games would say they were. It also
 * makes the constants comparable to each other — "this rate is worth 200 targets of prior" against
 * "this one is worth 20" — which is what makes the touchdown assertion an apples-to-apples one
 * rather than a slogan.
 *
 * NO RECENCY WEIGHTING, deliberately, unlike layer 1. Every opportunity in the available history
 * counts the same. Efficiency is barely predictable at all, so a decay would be a second knob
 * fighting the shrinkage constant over the same small amount of signal. It is named here as the
 * obvious ablation for a later phase rather than added on the assumption it helps.
 */

/** A rate's numerator on a `StatLine`, and the opportunity it is taken over. */
export interface RateSpec {
  readonly numerator: keyof Omit<StatLine, "playerId" | "week">;
  /** `plays` is every touch and throw — the denominator a fumble belongs to. */
  readonly denominator: "targets" | "carries" | "passAttempts" | "plays";
}

/**
 * Every rate the composer multiplies an opportunity by. Written out rather than derived, because
 * the pairing of a numerator with its denominator is the thing that has to be right: receiving
 * yards over CARRIES would produce a plausible number for every running back in the league.
 */
export const RATES = {
  receptionsPerTarget: { numerator: "receptions", denominator: "targets" },
  receivingYardsPerTarget: { numerator: "receivingYards", denominator: "targets" },
  receivingTouchdownsPerTarget: { numerator: "receivingTouchdowns", denominator: "targets" },
  rushingYardsPerCarry: { numerator: "rushingYards", denominator: "carries" },
  rushingTouchdownsPerCarry: { numerator: "rushingTouchdowns", denominator: "carries" },
  passingYardsPerAttempt: { numerator: "passingYards", denominator: "passAttempts" },
  passingTouchdownsPerAttempt: { numerator: "passingTouchdowns", denominator: "passAttempts" },
  interceptionsPerAttempt: { numerator: "interceptions", denominator: "passAttempts" },
  fumblesLostPerPlay: { numerator: "fumblesLost", denominator: "plays" },
} as const satisfies Readonly<Record<string, RateSpec>>;

export type RateName = keyof typeof RATES;

/**
 * The three rates whose regression must be strongest. Named as a constant rather than matched by
 * substring, so adding a fourth touchdown rate is a deliberate edit here and the pinning test picks
 * it up automatically.
 */
export const TOUCHDOWN_RATES = [
  "receivingTouchdownsPerTarget",
  "rushingTouchdownsPerCarry",
  "passingTouchdownsPerAttempt",
] as const satisfies readonly RateName[];

export interface EfficiencyPriors {
  /** Each position's mean rate — where a player with no record of his own sits. */
  readonly byPosition: Readonly<Record<Position, Readonly<Record<RateName, number>>>>;
  /** How many OPPORTUNITIES of prior each rate is worth. Larger means regressed harder. */
  readonly regression: Readonly<Record<RateName, number>>;
  /**
   * THE YEARS-4-6 EXPERIENCE TERM — one scalar per position, applied to every rate uniformly for a
   * player in his 4th through 6th season. See `experienceCohort` for how the cohort is computed and
   * `fitted.ts` for the fit window and the measured ratio behind each entry. A position absent here,
   * or present at exactly `1`, is a position the fit found no correction for — "let the fitted
   * magnitude decide" means a near-neutral measurement gets no term rather than a token one.
   */
  readonly experienceMultiplier?: Readonly<Partial<Record<Position, number>>>;
}

export type PlayerRates = Readonly<Record<RateName, number>>;

export interface EfficiencyContext {
  readonly season: number;
  /** The week being predicted. Nothing at or after it is evidence. */
  readonly week: number;
  readonly positions: ReadonlyMap<string, Position>;
  /**
   * A player's first season with a stamped week-one roster row (`firstRosterSeasonsThrough`),
   * OPTIONAL: omitted, the experience term is a no-op everywhere, exactly like every other optional
   * context this engine threads through a layer that predates the feature. The preseason model does
   * not pass this — it has its own, independent career-stage curve (`preseason/career.ts`), fitted a
   * different way, on a different clock; this map and that curve are never meant to agree by
   * construction, only to both have earned their place separately.
   */
  readonly firstRosterSeason?: ReadonlyMap<string, number>;
}

/**
 * THE COHORT A PLAYER'S CAREER YEAR FALLS IN, for the one band this layer corrects.
 *
 * Career year is `season - firstRosterSeason + 1`, not the roster release's own draft/entry year —
 * a second, independent measurement of the same underlying idea `preseason/career.ts` already uses,
 * built from Task 1's historical roster backfill instead of from `preseason_rosters.draft_year`.
 *
 * RIGHT-CENSORED AT THE BACKFILL FLOOR. `firstRosterSeasonsThrough` only sees rows back to
 * `HISTORICAL_ROSTER_FLOOR`; a player whose first stamped row IS that floor season may have debuted
 * any number of years earlier; his true career year is a LOWER bound, not a measurement. Placing him
 * in the "year 4-6" cohort on that basis would assert a career stage the data cannot support, so a
 * floor-anchored player computing to 6 years or fewer is excluded from the cohort outright rather
 * than guessed into it — he is scored as "other" (no term), never as a false rookie-adjacent player.
 */
export function experienceCohort(season: number, firstRosterSeason: number | null): "year4to6" | "other" {
  if (firstRosterSeason === null || !Number.isInteger(firstRosterSeason)) return "other";
  const careerYear = season - firstRosterSeason + 1;
  if (careerYear < 1) return "other";
  if (firstRosterSeason <= HISTORICAL_ROSTER_FLOOR && careerYear <= 6) return "other";
  return careerYear >= 4 && careerYear <= 6 ? "year4to6" : "other";
}

/** The bounded, guarded multiplier for one player — `1` (a no-op) for anyone not in the cohort. */
function experienceMultiplierFor(
  position: Position,
  playerId: string,
  season: number,
  firstRosterSeason: ReadonlyMap<string, number> | undefined,
  priors: EfficiencyPriors,
): number {
  if (firstRosterSeason === undefined || priors.experienceMultiplier === undefined) return 1;
  const cohort = experienceCohort(season, firstRosterSeason.get(playerId) ?? null);
  if (cohort !== "year4to6") return 1;
  const multiplier = priors.experienceMultiplier[position];
  return multiplier === undefined || !(multiplier > 0) || !Number.isFinite(multiplier) ? 1 : multiplier;
}

/** Every denominator a rate can be taken over. */
const DENOMINATORS = ["targets", "carries", "passAttempts", "plays"] as const;

type Denominator = (typeof DENOMINATORS)[number];

/**
 * THE OPPORTUNITIES ONE WEEK OFFERS A RATE, or `null` where the season never published the count.
 *
 * `usage.ts`'s participation counts are nullable for exactly one reason (see its own
 * `shareOrNull` docblock): a gap season's weekly stats file does not exist, so the backfill withheld
 * the counts rather than writing false zeros, and this reader must not put them back. Null here is
 * NOT the same statement as zero: zero opportunities is a man who played and was never thrown to,
 * null is a season nobody counted. Both end at the position prior downstream, but only one of them
 * is a fact.
 *
 * `plays` — the denominator a fumble belongs to — sums the components that ARE known and is null
 * only when none of the three is. A gap season's receiver contributes his targets and carries; his
 * pass attempts, which no feed carries for him, are simply not in the sum.
 */
export function opportunitiesFor(row: PlayerWeekUsage, denominator: Denominator): number | null {
  if (denominator !== "plays") return row[denominator];
  const known = [row.targets, row.carries, row.passAttempts].filter((count): count is number => count !== null);
  return known.length === 0 ? null : known.reduce((sum, count) => sum + count, 0);
}

/** One player's totals over the history a prediction may see. A denominator is `null` until a week
 *  actually carries it, so "never counted" stays distinct from "counted, and it was zero". */
interface Totals {
  readonly numerators: Record<RateName, number>;
  readonly denominators: Record<Denominator, number | null>;
}

function emptyTotals(): Totals {
  return {
    numerators: Object.fromEntries((Object.keys(RATES) as RateName[]).map((name) => [name, 0])) as Record<RateName, number>,
    denominators: { targets: null, carries: null, passAttempts: null, plays: null },
  };
}

/**
 * Predicts every player's rates for one week.
 *
 * Takes outcomes and opportunities separately and joins them on `(season, week, playerId)`, because
 * they come from different files and a player can legitimately have one without the other: a snap
 * row with no weekly stats line is a man who played and did nothing measurable, and counting his
 * targets without his yards would deflate his rate. Only weeks carrying BOTH contribute.
 *
 * Weeks at or after `week` are dropped here rather than trusted to the caller, matching
 * `predictOpportunity`. `replay` never passes any; a future caller might, and a rate fitted on the
 * week it is predicting would look excellent and be worthless.
 */
export function predictRates(
  history: readonly SeasonStatLine[],
  usage: readonly PlayerWeekUsage[],
  { season, week, positions, firstRosterSeason }: EfficiencyContext,
  priors: EfficiencyPriors,
): ReadonlyMap<string, PlayerRates> {
  const visible = (rowSeason: number, rowWeek: number): boolean =>
    rowSeason <= season && rowSeason >= season - 1 && !(rowSeason === season && rowWeek >= week);

  const lines = new Map<string, StatLine>();
  for (const row of history) {
    if (!visible(row.season, row.line.week)) continue;
    lines.set(`${row.season}|${row.line.week}|${row.line.playerId}`, row.line);
  }

  const totals = new Map<string, Totals>();
  for (const row of usage) {
    if (!visible(row.season, row.week)) continue;
    const line = lines.get(`${row.season}|${row.week}|${row.playerId}`);
    if (line === undefined) continue;
    const running = totals.get(row.playerId) ?? emptyTotals();
    for (const denominator of DENOMINATORS) {
      const opportunities = opportunitiesFor(row, denominator);
      if (opportunities === null) continue;
      running.denominators[denominator] = (running.denominators[denominator] ?? 0) + opportunities;
    }
    // A week contributes a rate's NUMERATOR exactly when it contributes that rate's denominator.
    // Counting the yards of a week whose targets nobody wrote down would divide real production by
    // a smaller opportunity count and read a gap in the feed as elite efficiency.
    for (const name of Object.keys(RATES) as RateName[]) {
      if (opportunitiesFor(row, RATES[name].denominator) === null) continue;
      running.numerators[name] += line[RATES[name].numerator];
    }
    totals.set(row.playerId, running);
  }

  const predictions = new Map<string, PlayerRates>();
  for (const playerId of [...totals.keys()].sort()) {
    const position = positions.get(playerId);
    if (position === undefined) continue;
    const player = totals.get(playerId)!;
    const rolePrior = priors.byPosition[position];
    const experienceMultiplier = experienceMultiplierFor(position, playerId, season, firstRosterSeason, priors);
    predictions.set(
      playerId,
      Object.fromEntries(
        (Object.keys(RATES) as RateName[]).map((name) => {
          const opportunities = player.denominators[RATES[name].denominator];
          const k = priors.regression[name];
          const prior = rolePrior[name];
          // No opportunities means no evidence, which is the prior — not a rate of zero. A receiver
          // who has not been thrown to has not been proven bad at catching, and neither has one
          // whose season nobody published an opportunity count for (`null`).
          const value = opportunities === null || opportunities <= 0 ? prior : (player.numerators[name] + k * prior) / (opportunities + k);
          return [name, Math.max(0, value * experienceMultiplier)];
        }),
      ) as PlayerRates,
    );
  }
  return predictions;
}
