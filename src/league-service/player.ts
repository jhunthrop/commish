import { and, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { matchups, players, playerStatLines, scoringSettings, statWeeks } from "@/db/schema";
import type { Player, Position } from "@/domain/player";
import { PPR_SCORING, type ScoringSettings } from "@/domain/scoring";
import { LEAGUE_CONFIG, seasonProgress } from "@/league";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@/scoring";

/**
 * One week of a player's season, as the detail screen draws it.
 *
 * `points` is `null` for a week that HAPPENED WITHOUT HIM — a bye, an inactive, a man signed in
 * October. It is never a zero: "did not play" and "played and scored nothing" are different facts
 * and this product keeps them apart everywhere else (`MatchupLineupEntry.points`, and
 * `NOT_STARTED_DASH` before it).
 *
 * `percentile` is where the week sits among every week played at his position this season, on the
 * 0..1 scale `StatComparison` uses. `null` where there is no population to speak of — the caller
 * then renders the number as ordinary ink, which is `Stat`'s own "no comparison, no colour".
 */
export interface PlayerWeekView {
  readonly week: number;
  readonly points: number | null;
  readonly percentile: number | null;
}

/**
 * Everything the player screen draws, and NOTHING WE CANNOT REACH.
 *
 * The screen's source strip compares three independent readings of one quantity — where the
 * market has him, where the experts have him, where OUR MODEL has him — and only the first of
 * those three exists at this layer today. The other two are absent from this body rather than
 * approximated in it, and the strip prints a dash for each. What blocks them, precisely:
 *
 * - **Expert consensus (FantasyPros ECR).** It IS in the database — `preseason_rankings`, source
 *   `fantasypros_ecr_ppr` — and it is unreachable from here for two independent reasons, either
 *   one fatal on its own. It is keyed to `nfl_players.id`, the GSIS id space the nflverse research
 *   corpus uses ("00-0033280"), while every league player is keyed to the stats provider's own id
 *   ("4362628"); there is no crosswalk between the two id spaces anywhere in the schema, and the
 *   research pipeline joins them by NAME at ingest time against its own roster (`resolveRankings`,
 *   `@/projections/preseason/benchmarks`), never against `players`. And the only seasons ingested
 *   are 2021 through 2024, the held-out seasons the model is scored on, not the season a league is
 *   currently playing.
 * - **Our own board.** `preseasonBoard` (`@/projections/preseason/board`) is a pure function whose
 *   only two callers are `scripts/preseason-report.ts` and `scripts/preseason-diagnose.ts`. Its
 *   output is printed to a research report and never persisted: there is no projections table in
 *   the schema, and no module under `src/app` or `src/league-service` imports it. The engine's
 *   published results are aggregate rank correlations over held-out seasons
 *   (`docs/research/2026-08-28-starter-band.md`), which is a fact about the BOARD and not a number
 *   about any one player.
 *
 * Both are a wiring job with a real shape — a crosswalk, and a table the fit writes into — and
 * neither is a thing a display layer may paper over in the meantime.
 */
export interface PlayerSeasonBody {
  readonly player: Player;
  /** His rank among players at his position by market draft position, or `null` where the ADP
   *  feed does not carry him. */
  readonly positionRank: number | null;
  /** Where his draft position sits among every ranked player, 0..1, best is 1. `null` when he is
   *  unranked, or when the feed ranks nobody else to compare him against. */
  readonly adpPercentile: number | null;
  /** Points per game over the weeks he actually played, under THIS league's scoring rules. */
  readonly pointsPerGame: number | null;
  readonly pointsPerGamePercentile: number | null;
  /** Every week of this league's season that has actually been played, in order. */
  readonly weeks: readonly PlayerWeekView[];
}

type Line = typeof playerStatLines.$inferSelect;

/**
 * Where `value` sits in `population`, 0..1, with 1 the best in the set.
 *
 * A population of fewer than two is not a population and returns `null` rather than a percentile
 * of 0.5 that would tint a number against nothing — the same refusal `Stat` makes for an unstated
 * comparison, kept here so the two cannot disagree.
 *
 * `better` decides which direction is up, because this file has both: more fantasy points is
 * better and a LOWER draft position is better, and a single "higher wins" helper would have
 * silently ranked the best player in the league last.
 */
function percentileOf(value: number, population: readonly number[], better: "higher" | "lower"): number | null {
  if (population.length < 2) return null;
  const worse = population.filter((other) => (better === "higher" ? other < value : other > value)).length;
  return worse / (population.length - 1);
}

/**
 * Every played week, with his own number and where that number stands.
 *
 * The population is EVERY WEEK PLAYED AT HIS POSITION THIS SEASON, not his own thirteen. A
 * player's weeks judged against themselves always produce a full spread of verdicts — a man with
 * thirteen identical afternoons gets a red week and a green one, which is a lie the reader has no
 * way to see. Against his position's whole season, a twenty-one point week is a big week because
 * it was a big week for a running back, which is the question a manager is actually asking.
 */
function weekViews(lines: readonly Line[], played: readonly number[], playerId: string, position: Position, rules: ScoringRules): readonly PlayerWeekView[] {
  const population = lines.map((line) => computeFantasyPoints(line, position, rules));
  const mine = new Map(lines.filter((line) => line.playerId === playerId).map((line) => [line.week, line] as const));
  return played.map((week): PlayerWeekView => {
    const line = mine.get(week);
    if (line === undefined) return { week, points: null, percentile: null };
    const points = computeFantasyPoints(line, position, rules);
    return { week, points, percentile: percentileOf(points, population, "higher") };
  });
}

/** Each peer's own points per game over the played weeks — the population `pointsPerGame` is
 *  judged against. A man with no played week is not in it: a season he did not have is not a
 *  season anyone's average should be measured against. */
function peerPointsPerGame(lines: readonly Line[], position: Position, rules: ScoringRules): readonly number[] {
  const totals = new Map<string, { total: number; games: number }>();
  for (const line of lines) {
    const running = totals.get(line.playerId) ?? { total: 0, games: 0 };
    totals.set(line.playerId, { total: running.total + computeFantasyPoints(line, position, rules), games: running.games + 1 });
  }
  return [...totals.values()].map((running) => roundPoints(running.total / running.games));
}

/**
 * A player's whole season on one screen, read under one league's scoring rules.
 *
 * WHY THE LEAGUE IS A PARAMETER AND NOT A CONVENIENCE. A fantasy point is not a property of a
 * player, it is a property of a player inside a rule set: the same catch is 1.0 points in this
 * league and 0.5 in the one next door. There is no honest league-free version of this page, which
 * is why it lives under `/leagues/[leagueId]/` and why this function reads the league's own
 * `scoring_settings` row (falling back to the same `PPR_SCORING` default `matchupWeek` already
 * falls back to, for a league whose row has not been written).
 *
 * ONLY WEEKS THAT HAPPENED. The gate is `stat_weeks.status`, never the presence of a stat line,
 * and the difference is not academic in this dataset: `player_stat_lines` carries rows for all
 * seventeen weeks while `stat_weeks` says thirteen have been played. A chart built on the rows
 * would draw four weeks of the future as results. The list is then capped by the LEAGUE's own
 * season length, so a fourteen-week league never draws a week it does not play.
 *
 * FOUR READS, and the one that could have been expensive is bounded: the peer stat lines are
 * fetched by an id list at his position (four hundred receivers, never sixteen hundred players)
 * crossed with the played weeks, and BOTH populations — every week at his position, and every
 * peer's points per game — are folded out of that single result rather than queried twice.
 */
export async function playerSeason(db: Db, leagueId: string, playerId: string): Promise<PlayerSeasonBody | null> {
  const [row] = await db.select().from(players).where(eq(players.id, playerId));
  if (row === undefined) return null;
  const player: Player = {
    id: row.id,
    name: row.name,
    position: row.position,
    nflTeam: row.nflTeam,
    headshotUrl: row.headshotUrl,
    adp: row.adp,
  };
  const adp = player.adp;

  const fixtures = await db.select().from(matchups).where(eq(matchups.leagueId, leagueId));
  const { totalWeeks } = seasonProgress(fixtures, LEAGUE_CONFIG.regularSeasonWeeks);
  const weekRows = await db.select({ week: statWeeks.week }).from(statWeeks).where(ne(statWeeks.status, "scheduled"));
  const played = weekRows.map((week) => week.week).filter((week) => week <= totalWeeks).sort((a, b) => a - b);

  const [settingsRow] = await db.select().from(scoringSettings).where(eq(scoringSettings.leagueId, leagueId));
  const settings: ScoringSettings = settingsRow ?? { leagueId, ...PPR_SCORING };
  const rules: ScoringRules = settings;

  const everyone = await db.select({ id: players.id, position: players.position, adp: players.adp }).from(players);
  const peers = everyone.filter((other) => other.position === player.position);
  const rankedAll = everyone.flatMap((other) => (other.adp === null ? [] : [other.adp]));

  const peerIds = peers.map((peer) => peer.id);
  const lines =
    peerIds.length === 0 || played.length === 0
      ? []
      : await db.select().from(playerStatLines).where(and(inArray(playerStatLines.playerId, peerIds), inArray(playerStatLines.week, played)));

  const weeks = weekViews(lines, played, playerId, player.position, rules);
  const mine = weeks.flatMap((week) => (week.points === null ? [] : [week.points]));
  const pointsPerGame = mine.length === 0 ? null : roundPoints(mine.reduce((sum, points) => sum + points, 0) / mine.length);

  return {
    player,
    positionRank: adp === null ? null : 1 + peers.filter((peer) => peer.adp !== null && peer.adp < adp).length,
    adpPercentile: adp === null ? null : percentileOf(adp, rankedAll, "lower"),
    pointsPerGame,
    pointsPerGamePercentile: pointsPerGame === null ? null : percentileOf(pointsPerGame, peerPointsPerGame(lines, player.position, rules), "higher"),
    weeks,
  };
}
