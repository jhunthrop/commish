import type { ReadonlyDb } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import type { Position, StatLine } from "@/domain/player";
import { projectedPosition } from "./nflverse/players";
import { computeFantasyPoints, type ScoringRules } from "@/scoring/compute";
import { statLinesAsOf, type SeasonStatLine } from "./lines";
import { predictOpportunity, type OpportunityPriors } from "./model/opportunity";
import { LAST_POSSIBLE_WEEK } from "./store";
import { usageAsOf, type PlayerWeekUsage } from "./usage";
import { rankBandFor, scoreCard, RANK_BANDS, type Observation, type RankBandName, type ScoreCard } from "./metrics";

/**
 * THE BACKTEST. Replays a season a week at a time, showing a projection source only what existed
 * before that week's games, and scores what it said against what happened.
 *
 * This is the instrument the whole phase exists to build. Everything the engine will ever claim —
 * that a feature earns its place, that the news pass adds something, that we beat the market — is
 * answered here or it is not answered. And the single way this instrument can lie is by letting
 * the future in: one stray column stamped after kickoff and the model looks brilliant and is
 * worthless, and by the time anyone notices, every measurement ever taken is suspect.
 *
 * So there is exactly one path from the store into a source's hands — `statLinesAsOf`, carrying
 * the `as_of <= …` predicate — and this module never queries observations any other way. The
 * ACTUALS are read separately and deliberately without that gate, because an outcome is what
 * really happened, including a correction published afterwards; those two reads are the only two,
 * and they are a few lines apart so the difference between them is visible rather than buried.
 */

/** Everything a source is allowed to know when projecting one week. */
export interface ProjectionInput {
  readonly season: number;
  readonly week: number;
  /** The replay moment. Nothing stamped after this reached `history`, by construction. */
  readonly asOf: Date;
  /** Every outcome knowable at `asOf`, this season and the seasons before it. */
  readonly history: readonly SeasonStatLine[];
  /**
   * Every player's OPPORTUNITY knowable at `asOf`, over the same span — snap, target, carry and
   * pass-attempt shares beside the team volumes they were taken against.
   *
   * Read here rather than by the source, and through `usageAsOf`, so that the single as-of gate
   * still governs everything a source can see. A source that opened its own connection would be a
   * second path from the store into a projection, and a leak on a second path looks exactly like a
   * very good model.
   */
  readonly usage: readonly PlayerWeekUsage[];
  /** From `nfl_players`, narrowed. A player absent here is one the engine cannot score. */
  readonly positions: ReadonlyMap<string, Position>;
}

export interface ProjectionSource {
  /** How this source appears on a scoreboard. */
  readonly name: string;
  project(input: ProjectionInput): readonly StatLine[] | Promise<readonly StatLine[]>;
}

export interface ReplayOptions {
  readonly season: number;
  readonly weeks: readonly number[];
  readonly source: ProjectionSource;
  /** The league's real scoring. A projection is components; points are a composition of them. */
  readonly rules: ScoringRules;
  /**
   * The moment week W is replayed from — everything stamped later is invisible to the source.
   *
   * REQUIRED and injected, never derived in here. The honest moment is a fact about the real
   * world (when did the previous week's numbers land) and the caller holds it, having ingested the
   * data. A default computed from the store would be a guess dressed as a guarantee, and this is
   * the one parameter in the engine where a plausible-looking guess is worse than no answer.
   */
  readonly asOfForWeek: (week: number) => Date;
  /** How many seasons back a source may look, counting the season being replayed. Default 2. */
  readonly historySeasons?: number;
}

export interface BandedScore {
  readonly overall: ScoreCard;
  /** Every band, always — an empty one reports a zero sample rather than going missing. */
  readonly byRankBand: Readonly<Record<RankBandName, ScoreCard>>;
}

export interface WeekReplay extends BandedScore {
  readonly week: number;
  readonly asOf: Date;
}

export interface ReplayResult extends BandedScore {
  readonly source: string;
  readonly weeks: readonly WeekReplay[];
}

/**
 * The moment the actuals are read at: far past any real correction.
 *
 * The actual is what a player REALLY did, which includes a stat correction published a week later.
 * A backtest that scored against the numbers briefly believed on Sunday night would be measuring
 * how well a projection predicted a typo. This is the one read in the module that intentionally
 * has no as-of gate, and it is a named constant so that is impossible to miss.
 */
const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

const DEFAULT_HISTORY_SEASONS = 2;

/** One scored player, carrying the band its projected rank put it in. */
interface BandedObservation extends Observation {
  readonly band: RankBandName;
}

function emptyCard(): ScoreCard {
  return { rankCorrelation: null, meanAbsoluteError: null, rootMeanSquaredError: null, sampleSize: 0 };
}

function scoreBanded(entries: readonly BandedObservation[]): BandedScore {
  const byRankBand = Object.fromEntries(
    RANK_BANDS.map((band) => {
      const inBand = entries.filter((entry) => entry.band === band.name);
      return [band.name, inBand.length === 0 ? emptyCard() : scoreCard(inBand)];
    }),
  ) as Record<RankBandName, ScoreCard>;
  return { overall: entries.length === 0 ? emptyCard() : scoreCard(entries), byRankBand };
}

/**
 * Which band a scored player counts in: the band its own PROJECTED rank put it in.
 *
 * Banding by projected rank answers the question a manager actually acts on — "of the players this
 * source called deep, how well did it order them?" — and it is knowable before the games, which
 * banding by outcome would not be. The cost is that two sources' bands hold different players, so
 * a band-by-band comparison between sources is indicative rather than exact. The fix is to band by
 * a COMMON prior (ADP), and that arrives with the ADP benchmark; until then this is the honest
 * approximation and this note is the record that it is one.
 */
function bandByProjectedRank(projections: readonly { playerId: string; points: number }[]): ReadonlyMap<string, RankBandName> {
  return new Map(
    [...projections]
      .sort((a, b) => b.points - a.points)
      .map((projection, index) => [projection.playerId, rankBandFor(index + 1)] as const),
  );
}

/**
 * Position comes from the HISTORICAL universe (`nfl_players`), not from `players`.
 *
 * `players` is a current roster snapshot, so scoring a 2021 replay through it would silently drop
 * every player who has since retired — the same defect that made a Phase 1 backfill lose ten points
 * of coverage per season going backwards (Phase 2, Task 1). A player whose universe position does
 * not narrow to one this product scores (a centre, a linebacker) is omitted rather than guessed at,
 * and omission here means excluded from BOTH the projections and the actuals, so the comparison
 * stays over the same set of people.
 */
export async function allPositions(db: ReadonlyDb): Promise<ReadonlyMap<string, Position>> {
  const rows = await db.select({ id: nflPlayers.id, position: nflPlayers.position }).from(nflPlayers);
  return new Map(
    rows
      .map((row) => [row.id, projectedPosition(row.position)] as const)
      .filter((entry): entry is readonly [string, Position] => entry[1] !== null),
  );
}

/** One replayed week, before any scoring: what each source said, and what really happened. */
interface WeekOutcome {
  readonly week: number;
  readonly asOf: Date;
  /** Projected points per player, one map per source, in the order the sources were given. */
  readonly projected: readonly ReadonlyMap<string, number>[];
  readonly actual: ReadonlyMap<string, number>;
}

/**
 * Replays every week once, showing EVERY source the identical history.
 *
 * One pass rather than one pass per source, and that is not only an optimisation: two sources
 * scored from two separate passes could in principle be shown different data — a store written
 * between the passes, a clock read twice — and the whole point of a head-to-head is that the only
 * difference between the two columns is the model.
 */
async function replayWeeks(
  db: ReadonlyDb,
  season: number,
  weeks: readonly number[],
  sources: readonly ProjectionSource[],
  rules: ScoringRules,
  asOfForWeek: (week: number) => Date,
  historySeasons: number,
): Promise<readonly WeekOutcome[]> {
  // Ascending, whatever order the caller listed them in: a replay that ran week 3 before week 2
  // would still be leak-free (each week's own as-of gate holds) but the scoreboard would read as
  // though the season happened out of order, and a stateful source would be shown history backwards.
  const inOrder = [...weeks].sort((a, b) => a - b);
  const earliestSeason = season - historySeasons + 1;
  // Read once, outside the loop. Position is the one fact in this instrument that carries no as-of
  // and never will: a man's position is not restated by a Sunday-night stat correction, and reading
  // it per week would be eighteen identical queries pretending to be a point-in-time read.
  const positions = await allPositions(db);
  const outcomes: WeekOutcome[] = [];

  for (const week of inOrder) {
    const asOf = asOfForWeek(week);
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
      throw new Error(`No replay moment is known for ${season} week ${week}; a week cannot be replayed from a guessed date.`);
    }

    // History: every season the source may see, up to the week BEFORE the one being projected,
    // and nothing stamped after the replay moment. Both bounds matter — the as-of gate alone would
    // still admit a pre-kickoff fact about this week, which is not what "history" means.
    const history: SeasonStatLine[] = [];
    const usage: PlayerWeekUsage[] = [];
    for (let historySeason = earliestSeason; historySeason <= season; historySeason += 1) {
      const upTo = historySeason === season ? week - 1 : LAST_POSSIBLE_WEEK;
      if (upTo < 1) continue;
      const span = { season: historySeason, week: { from: 1, to: upTo }, asOf } as const;
      history.push(...(await statLinesAsOf(db, span)));
      usage.push(...(await usageAsOf(db, span)));
    }

    const pointsOf = (line: StatLine): number | null => {
      const position = positions.get(line.playerId);
      return position === undefined ? null : computeFantasyPoints(line, position, rules);
    };
    const asPoints = (lines: readonly StatLine[]): ReadonlyMap<string, number> => {
      const points = new Map<string, number>();
      for (const line of lines) {
        const value = pointsOf(line);
        if (value !== null) points.set(line.playerId, value);
      }
      return points;
    };

    const projected: ReadonlyMap<string, number>[] = [];
    for (const source of sources) {
      projected.push(asPoints(await source.project({ season, week, asOf, history, usage, positions })));
    }
    const actuals = await statLinesAsOf(db, { season, week, asOf: FINAL_OUTCOME });
    outcomes.push({ week, asOf, projected, actual: asPoints(actuals.map((row) => row.line)) });
  }
  return outcomes;
}

/**
 * Scores one source over the weeks already replayed, optionally narrowed to a set of players.
 *
 * `eligible` is what makes a head-to-head fair. Without it, a source that has an opinion about more
 * players is scored over a different population than the one it is being compared to — and since
 * the extra players are overwhelmingly low scorers who are easy to order correctly, a broader source
 * can post a higher rank correlation on breadth alone. Both numbers are worth having, so both are
 * reported; neither is worth having on its own.
 */
function scoreSource(
  name: string,
  outcomes: readonly WeekOutcome[],
  index: number,
  eligible?: (outcome: WeekOutcome) => ReadonlySet<string>,
): ReplayResult {
  const weekReplays: WeekReplay[] = [];
  const pooled: BandedObservation[] = [];

  for (const outcome of outcomes) {
    const allowed = eligible?.(outcome);
    const projectedPoints = [...outcome.projected[index]!.entries()]
      .filter(([playerId]) => allowed === undefined || allowed.has(playerId))
      .map(([playerId, points]) => ({ playerId, points }));
    const bands = bandByProjectedRank(projectedPoints);

    // Only players with BOTH a projection and an outcome are scored, and `sampleSize` carries how
    // many that was. Scoring a source over the players it chose to have an opinion about is what
    // stops a narrow, cautious source looking better than a comprehensive one.
    const entries: BandedObservation[] = projectedPoints
      .filter((entry) => outcome.actual.has(entry.playerId))
      .map((entry) => ({
        predicted: entry.points,
        actual: outcome.actual.get(entry.playerId)!,
        band: bands.get(entry.playerId)!,
      }));

    pooled.push(...entries);
    weekReplays.push({ week: outcome.week, asOf: outcome.asOf, ...scoreBanded(entries) });
  }

  return { source: name, weeks: weekReplays, ...scoreBanded(pooled) };
}

export async function replay(
  db: ReadonlyDb,
  { season, weeks, source, rules, asOfForWeek, historySeasons = DEFAULT_HISTORY_SEASONS }: ReplayOptions,
): Promise<ReplayResult> {
  const outcomes = await replayWeeks(db, season, weeks, [source], rules, asOfForWeek, historySeasons);
  return scoreSource(source.name, outcomes, 0);
}

export interface HeadToHeadOptions extends Omit<ReplayOptions, "source"> {
  /** Two or more sources, shown identical history and scored by identical code. */
  readonly sources: readonly ProjectionSource[];
}

export interface HeadToHead {
  /** Each source over the players IT had an opinion about — the number it earns on its own terms. */
  readonly full: readonly ReplayResult[];
  /** Each source over only the players EVERY source projected — the like-for-like comparison. */
  readonly common: readonly ReplayResult[];
}

/**
 * Two or more sources over one season, scored both on their own terms and like for like.
 *
 * The like-for-like column exists because breadth flatters rank correlation. A model that projects
 * every player who has taken a snap is scored over hundreds of extra low-scoring player-weeks that
 * are easy to order correctly, and posts a better number than a narrower source without being
 * better at anything a manager cares about. Restricting to the intersection removes that advantage
 * entirely; reporting only the restricted number would hide a real one (coverage IS worth
 * something). So both are computed, from one pass, and the difference between them is itself a
 * result worth reading.
 */
export async function replayHeadToHead(
  db: ReadonlyDb,
  { season, weeks, sources, rules, asOfForWeek, historySeasons = DEFAULT_HISTORY_SEASONS }: HeadToHeadOptions,
): Promise<HeadToHead> {
  if (sources.length < 2) {
    throw new Error("A head-to-head needs at least two sources; one source is a replay.");
  }
  const outcomes = await replayWeeks(db, season, weeks, sources, rules, asOfForWeek, historySeasons);
  const intersection = (outcome: WeekOutcome): ReadonlySet<string> => {
    const [first, ...rest] = outcome.projected;
    return new Set([...first!.keys()].filter((playerId) => rest.every((other) => other.has(playerId))));
  };
  return {
    full: sources.map((source, index) => scoreSource(source.name, outcomes, index)),
    common: sources.map((source, index) => scoreSource(source.name, outcomes, index, intersection)),
  };
}

/** The four shares the opportunity model predicts, as they are keyed on `PlayerWeekUsage`. */
export const SHARE_FIELDS = ["snapShare", "targetShare", "carryShare", "passAttemptShare"] as const;
export type ShareField = (typeof SHARE_FIELDS)[number];

export interface OpportunityReplayOptions {
  readonly season: number;
  readonly weeks: readonly number[];
  readonly asOfForWeek: (week: number) => Date;
  readonly priors: OpportunityPriors;
  readonly historySeasons?: number;
}

export interface OpportunityReplayResult {
  /** Predicted share against observed share, per share and pooled over all of them. */
  readonly byShare: Readonly<Record<ShareField, readonly Observation[]>>;
  readonly pooled: readonly Observation[];
}

/**
 * SCORING LAYER 1 ON ITS OWN TERMS, before it has touched a single fantasy point.
 *
 * This is the measurement that has to come first. If predicted target share is not better than
 * "whatever his share was last week", nothing composed on top of it can be — and the failure would
 * be invisible in a points scoreboard, where an efficiency error and an opportunity error look
 * identical. Separating them is the only way to know which half is wrong.
 *
 * Point-in-time throughout, exactly as `replay` is: each week's prediction is made from usage read
 * through the as-of gate at that week's replay moment, and scored against the FINAL, corrected
 * usage. Evaluating against a flat season-long read would let a stat correction published in
 * December inform an October prediction — a small leak, but the small ones are the ones that
 * survive review.
 */
export async function replayOpportunity(
  db: ReadonlyDb,
  { season, weeks, asOfForWeek, priors, historySeasons = DEFAULT_HISTORY_SEASONS }: OpportunityReplayOptions,
): Promise<OpportunityReplayResult> {
  const positions = await allPositions(db);
  const earliestSeason = season - historySeasons + 1;
  const byShare: Record<ShareField, Observation[]> = {
    snapShare: [],
    targetShare: [],
    carryShare: [],
    passAttemptShare: [],
  };

  for (const week of [...weeks].sort((a, b) => a - b)) {
    const asOf = asOfForWeek(week);
    const history: PlayerWeekUsage[] = [];
    for (let historySeason = earliestSeason; historySeason <= season; historySeason += 1) {
      const upTo = historySeason === season ? week - 1 : LAST_POSSIBLE_WEEK;
      if (upTo < 1) continue;
      history.push(...(await usageAsOf(db, { season: historySeason, week: { from: 1, to: upTo }, asOf })));
    }
    const predictions = predictOpportunity(history, { season, week, positions }, priors);
    const actuals = await usageAsOf(db, { season, week, asOf: FINAL_OUTCOME });

    for (const actual of actuals) {
      const predicted = predictions.get(actual.playerId);
      if (predicted === undefined) continue;
      for (const field of SHARE_FIELDS) {
        const observed = actual[field];
        if (observed === null) continue;
        byShare[field].push({ predicted: predicted[field], actual: observed });
      }
    }
  }

  return { byShare, pooled: SHARE_FIELDS.flatMap((field) => byShare[field]) };
}
