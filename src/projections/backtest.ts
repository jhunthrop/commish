import { eq, inArray } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { nflPlayers } from "@/db/schema";
import type { Position, StatLine } from "@/domain/player";
import { projectedPosition } from "./nflverse/players";
import { computeFantasyPoints, type ScoringRules } from "@/scoring/compute";
import { statLinesAsOf, type SeasonStatLine } from "./lines";
import { LAST_POSSIBLE_WEEK } from "./store";
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
async function positionsOf(db: ReadonlyDb, playerIds: readonly string[]): Promise<ReadonlyMap<string, Position>> {
  if (playerIds.length === 0) return new Map();
  const rows = await db
    .select({ id: nflPlayers.id, position: nflPlayers.position })
    .from(nflPlayers)
    .where(playerIds.length === 1 ? eq(nflPlayers.id, playerIds[0]!) : inArray(nflPlayers.id, playerIds));
  return new Map(
    rows
      .map((row) => [row.id, projectedPosition(row.position)] as const)
      .filter((entry): entry is readonly [string, Position] => entry[1] !== null),
  );
}

export async function replay(
  db: ReadonlyDb,
  { season, weeks, source, rules, asOfForWeek, historySeasons = DEFAULT_HISTORY_SEASONS }: ReplayOptions,
): Promise<ReplayResult> {
  // Ascending, whatever order the caller listed them in: a replay that ran week 3 before week 2
  // would still be leak-free (each week's own as-of gate holds) but the scoreboard would read as
  // though the season happened out of order, and a stateful source would be shown history backwards.
  const inOrder = [...weeks].sort((a, b) => a - b);
  const earliestSeason = season - historySeasons + 1;
  const weekReplays: WeekReplay[] = [];
  const pooled: BandedObservation[] = [];

  for (const week of inOrder) {
    const asOf = asOfForWeek(week);
    if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
      throw new Error(`No replay moment is known for ${season} week ${week}; a week cannot be replayed from a guessed date.`);
    }

    // History: every season the source may see, up to the week BEFORE the one being projected,
    // and nothing stamped after the replay moment. Both bounds matter — the as-of gate alone would
    // still admit a pre-kickoff fact about this week, which is not what "history" means.
    const history: SeasonStatLine[] = [];
    for (let historySeason = earliestSeason; historySeason <= season; historySeason += 1) {
      const upTo = historySeason === season ? week - 1 : LAST_POSSIBLE_WEEK;
      if (upTo < 1) continue;
      history.push(...(await statLinesAsOf(db, { season: historySeason, week: { from: 1, to: upTo }, asOf })));
    }

    const projected = await source.project({ season, week, asOf, history });
    const actuals = await statLinesAsOf(db, { season, week, asOf: FINAL_OUTCOME });

    const positions = await positionsOf(db, [
      ...new Set([...projected.map((line) => line.playerId), ...actuals.map((row) => row.line.playerId)]),
    ]);
    const pointsOf = (line: StatLine): number | null => {
      const position = positions.get(line.playerId);
      return position === undefined ? null : computeFantasyPoints(line, position, rules);
    };

    const actualPoints = new Map<string, number>();
    for (const { line } of actuals) {
      const points = pointsOf(line);
      if (points !== null) actualPoints.set(line.playerId, points);
    }

    const projectedPoints = projected
      .map((line) => ({ playerId: line.playerId, points: pointsOf(line) }))
      .filter((entry): entry is { playerId: string; points: number } => entry.points !== null);
    const bands = bandByProjectedRank(projectedPoints);

    // Only players with BOTH a projection and an outcome are scored, and `sampleSize` carries how
    // many that was. Scoring a source over the players it chose to have an opinion about is what
    // stops a narrow, cautious source looking better than a comprehensive one.
    const entries: BandedObservation[] = projectedPoints
      .filter((entry) => actualPoints.has(entry.playerId))
      .map((entry) => ({
        predicted: entry.points,
        actual: actualPoints.get(entry.playerId)!,
        band: bands.get(entry.playerId)!,
      }));

    pooled.push(...entries);
    weekReplays.push({ week, asOf, ...scoreBanded(entries) });
  }

  return { source: source.name, weeks: weekReplays, ...scoreBanded(pooled) };
}
