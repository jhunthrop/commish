import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { captureSnapshots, matchups, players, playerStatLines, rosterSlots, scoringSettings, statWeeks, teams } from "@/db/schema";
import type { Player, Position } from "@/domain/player";
import { PPR_SCORING, type ScoringSettings } from "@/domain/scoring";
import type { Clock } from "@/domain/timing";
import { LEAGUE_CONFIG, seasonProgress } from "@/league";
import { nflPlayerIdFor } from "@/projections/crosswalk";
import type { Law } from "@/projections/laws/types";
import { chipEligibleLaws, registry } from "@/projections/laws/registry";
import { BENCHMARK_SOURCES } from "@/projections/preseason/benchmarks";
import type { BoardReason } from "@/projections/preseason/board";
import { BOARD_SOURCE, boardReasons, preseasonProjectionsFor } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { preseasonRankingsFor } from "@/projections/preseason/store";
import { computeFantasyPoints, roundPoints, type ScoringRules } from "@/scoring";

/** The outermost edge is the only place a wall clock is allowed, exactly as every other service
 *  in this directory has it. */
const systemClock: Clock = { now: () => new Date().toISOString() };

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

/** One played week's raw production — the game log's row (founder, 2026-08-30: ESPN-depth card). */
export interface PlayerGameLogRow {
  readonly week: number;
  readonly points: number;
  readonly carries: number;
  readonly rushingYards: number;
  readonly targets: number;
  readonly receptions: number;
  readonly receivingYards: number;
  readonly passingYards: number;
  /** Offensive touchdowns of every kind, one column — the log is a scan, not a box score. */
  readonly touchdowns: number;
}

/** The season summed, from the same lines the log itemizes. */
export interface PlayerSeasonTotals {
  readonly games: number;
  readonly carries: number;
  readonly rushingYards: number;
  readonly targets: number;
  readonly receptions: number;
  readonly receivingYards: number;
  readonly passingYards: number;
  readonly touchdowns: number;
  readonly fantasyPoints: number;
}

/**
 * Everything the player screen draws, and NOTHING WE CANNOT REACH.
 *
 * The screen's source strip compares three independent readings of one quantity — where the
 * market has him, where the experts have him, where OUR MODEL has him. All three are now computed
 * here, and each is `null` for a player it genuinely cannot be computed for. What each one costs:
 *
 * - **The market** is `players.adp`, already on the row.
 * - **Expert consensus** is `preseason_rankings`, source `fantasypros_ecr_ppr`, read through
 *   `player_crosswalk` — the id join that did not exist when this docblock was first written and
 *   was the reason the cell printed a dash. It resolves for a player the crosswalk placed AND the
 *   publisher ranked, which for the current season is 441 of the 518 names on the board.
 * - **Our own board** is `preseason_projections`, source `commish_board_v3_ppr_12` (fix round 2,
 *   2026-08-31 — the market-blended board, bumped a second time after a real correctness bug in v2's
 *   own stored pricing; `commish_board_v1_ppr_12` is the raw model's own historical source, kept for
 *   provenance but no longer what a live product surface reads), read through the same crosswalk.
 *   It is EMPTY FOR THE CURRENT SEASON and stated as such rather than
 *   backfilled from a season that has finished: the board needs three prior seasons of ingested
 *   usage and a replay moment derived from games already played, and the store holds 2021 to 2024.
 *   Showing 2024's number beside this year's consensus would be the most plausible-looking lie
 *   this product could tell. `docs/research/2026-08-28-live-season.md` scopes what closes it.
 *
 * BOTH ARE READ AT `now`, through the same `as_of <=` gate the backtest uses. A product surface
 * lives in the present, so "everything knowable now" is both the honest read and exactly the
 * predicate a replay would use standing here — which is what lets the same store serve both.
 */
export interface PlayerSeasonBody {
  readonly player: Player;
  /** His rank among players at his position by market draft position, or `null` where the ADP
   *  feed does not carry him. */
  readonly positionRank: number | null;
  /** Where his draft position sits among every ranked player, 0..1, best is 1. `null` when he is
   *  unranked, or when the feed ranks nobody else to compare him against. */
  readonly adpPercentile: number | null;
  /**
   * Expert consensus rank for this season, or `null` where the crosswalk could not place him or
   * the publisher does not rank him. Never approximated from a neighbouring season: a consensus is
   * a claim about one August and it stops being one the moment it is borrowed.
   */
  readonly expertRank: number | null;
  /** Our own board's overall rank for this season, or `null` where there is no board for him.
   *  Empty for every player while the current season has no board — see the type's docblock. */
  readonly modelRank: number | null;
  /** Points per game over the weeks he actually played, under THIS league's scoring rules. */
  readonly pointsPerGame: number | null;
  readonly pointsPerGamePercentile: number | null;
  /** Every week of this league's season that has actually been played, in order. */
  readonly weeks: readonly PlayerWeekView[];
  /** Which of THIS league's teams holds him, or `null` for a free agent here. */
  readonly ownedBy: string | null;
  /** His current designation from the harvested injuries feed ("Q", "O", "IR"), or `null` when
   *  the feed does not name him — absence means healthy as far as the source says. */
  readonly injuryDesignation: string | null;
  /** Raw production per played week, newest first — the ESPN-depth game log. */
  readonly log: readonly PlayerGameLogRow[];
  readonly totals: PlayerSeasonTotals | null;
  /** Recent headlines that name him, newest first, from the harvested news feed. */
  readonly news: readonly { readonly title: string; readonly link: string }[];
  /**
   * Task 8: every reason the CURRENT season's board stored for him (`boardReasons`, `BOARD_SOURCE`,
   * `PRODUCT_SEASON`) — the Outlook section's full chain, never truncated to a compact row's top
   * two the way the draft board's sticker is. Empty for a player the crosswalk could not place or
   * the board never ranked, the same "absence means nothing to say" rule `boardReasons` itself
   * keeps.
   */
  readonly reasons: readonly BoardReason[];
  /** The law registry, for `ReasonChip`'s own claim lookup on a `"law"` reason. */
  readonly laws: readonly Law[];
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
 * The two preseason readings for one man: where the experts had him, where our board had him.
 *
 * ONE CROSSWALK LOOKUP GATES BOTH. A league player the crosswalk could not place has no gsis id,
 * and both stores are keyed on one, so there is nothing to look up and the honest answer to both
 * questions is `null`. There is no fallback by name here and there must never be one: the only
 * thing worse than a dash on a player's screen is another man's number on it.
 *
 * `asOf` is the caller's `now` and it is passed to both reads. That is the same `as_of <=` gate a
 * backtest uses, standing in the present rather than in 2023, which is what lets one store serve
 * the harness and the product without either of them holding a special case for the other.
 */
async function preseasonReadings(
  db: Db,
  playerId: string,
  asOf: Date,
): Promise<{ readonly expertRank: number | null; readonly modelRank: number | null; readonly reasons: readonly BoardReason[] }> {
  const nflPlayerId = await nflPlayerIdFor(db, playerId);
  if (nflPlayerId === null) return { expertRank: null, modelRank: null, reasons: [] };

  const season = PRODUCT_SEASON;
  const [consensus] = await preseasonRankingsFor(db, { season, source: BENCHMARK_SOURCES.ecr, asOf }, [nflPlayerId]);
  const [ours] = await preseasonProjectionsFor(db, { season, source: BOARD_SOURCE, asOf }, [nflPlayerId]);
  // Task 8's own Outlook section. `boardReasons` reads every reason the CURRENT season's board
  // stored (no `playerId` narrowing exists on that reader yet — see `board-store.ts`), so this
  // costs one whole-board read per player-season request rather than one row; acceptable for a
  // bottom-sheet peek opened one player at a time, flagged rather than "fixed" here since a
  // narrowed reader is outside this task's file list.
  const reasons = (await boardReasons(db, BOARD_SOURCE, season)).get(nflPlayerId) ?? [];
  return { expertRank: consensus?.rank ?? null, modelRank: ours?.rank ?? null, reasons };
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
 *
 * THE RANKING READS ARE BOUNDED TO ONE MAN BY CONSTRUCTION: the crosswalk is a primary-key
 * lookup and both `preseasonRankingsFor`/`preseasonProjectionsFor` reads take his single gsis id,
 * so nothing here loads a five-hundred-name board to find one row on it. Skipped entirely for a
 * player the crosswalk could not place, which is the cheap case as well as the correct one.
 * `boardReasons` (Task 8's Outlook read) is the one exception: it has no per-player narrowing
 * yet, so it reads every reason the season's board stored and this function keeps only his own —
 * see `preseasonReadings`'s own inline note.
 */
/** His designation off the latest harvested injuries snapshot; `null` when the feed does not
 *  name him. One small read, latest row only. */
async function injuryDesignationFor(db: Db, playerId: string): Promise<string | null> {
  const [snapshot] = await db
    .select({ payload: captureSnapshots.payload })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, "tank01_injuries_by_date"))
    .orderBy(desc(captureSnapshots.capturedAt))
    .limit(1);
  const body = snapshot?.payload as Record<string, unknown> | undefined;
  const list = body?.injList;
  if (!Array.isArray(list)) return null;
  for (const raw of list) {
    const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    if (entry.playerID === playerId && typeof entry.designation === "string" && entry.designation !== "") return entry.designation;
  }
  return null;
}

/** Headlines that name him, from the latest harvested news snapshot. The feed carries no
 *  playerID, only titles in Tank01's own "Name: sentence" convention — the prefix is the join,
 *  strict on purpose: a missed headline costs nothing, another man's headline on his card is
 *  the failure this guards. */
async function newsFor(db: Db, name: string): Promise<readonly { readonly title: string; readonly link: string }[]> {
  const [snapshot] = await db
    .select({ payload: captureSnapshots.payload })
    .from(captureSnapshots)
    .where(eq(captureSnapshots.source, "tank01_news"))
    .orderBy(desc(captureSnapshots.capturedAt))
    .limit(1);
  const body = snapshot?.payload;
  if (!Array.isArray(body)) return [];
  const stories: { title: string; link: string }[] = [];
  for (const raw of body) {
    const entry = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const title = typeof entry.title === "string" ? entry.title : "";
    const link = typeof entry.link === "string" ? entry.link : "";
    if (title.startsWith(`${name}:`) && link !== "") stories.push({ title, link });
    if (stories.length === 3) break;
  }
  return stories;
}

export async function playerSeason(
  db: Db,
  leagueId: string,
  playerId: string,
  clock: Clock = systemClock,
): Promise<PlayerSeasonBody | null> {
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

  const preseason = await preseasonReadings(db, playerId, new Date(clock.now()));

  // The ESPN-depth additions (founder, 2026-08-30): his own raw lines are already in `lines`
  // (he is his own peer), so the log and the totals cost no extra read.
  const myLines = lines
    .filter((line) => line.playerId === playerId)
    .sort((a, b) => b.week - a.week);
  const log: PlayerGameLogRow[] = myLines.map((line) => ({
    week: line.week,
    points: computeFantasyPoints(line, player.position, rules),
    carries: line.carries,
    rushingYards: line.rushingYards,
    targets: line.targets,
    receptions: line.receptions,
    receivingYards: line.receivingYards,
    passingYards: line.passingYards,
    touchdowns: line.rushingTouchdowns + line.receivingTouchdowns + line.passingTouchdowns,
  }));
  const totals: PlayerSeasonTotals | null =
    log.length === 0
      ? null
      : log.reduce(
          (sum, row) => ({
            games: sum.games + 1,
            carries: sum.carries + row.carries,
            rushingYards: sum.rushingYards + row.rushingYards,
            targets: sum.targets + row.targets,
            receptions: sum.receptions + row.receptions,
            receivingYards: sum.receivingYards + row.receivingYards,
            passingYards: sum.passingYards + row.passingYards,
            touchdowns: sum.touchdowns + row.touchdowns,
            fantasyPoints: roundPoints(sum.fantasyPoints + row.points),
          }),
          { games: 0, carries: 0, rushingYards: 0, targets: 0, receptions: 0, receivingYards: 0, passingYards: 0, touchdowns: 0, fantasyPoints: 0 },
        );

  const [holder] = await db
    .select({ teamName: teams.name })
    .from(rosterSlots)
    .innerJoin(teams, eq(teams.id, rosterSlots.teamId))
    .where(and(eq(teams.leagueId, leagueId), eq(rosterSlots.playerId, playerId)))
    .limit(1);
  const [injuryDesignation, news] = await Promise.all([injuryDesignationFor(db, playerId), newsFor(db, player.name)]);

  return {
    ownedBy: holder?.teamName ?? null,
    injuryDesignation,
    log,
    totals,
    news,
    player,
    positionRank: adp === null ? null : 1 + peers.filter((peer) => peer.adp !== null && peer.adp < adp).length,
    adpPercentile: adp === null ? null : percentileOf(adp, rankedAll, "lower"),
    expertRank: preseason.expertRank,
    modelRank: preseason.modelRank,
    pointsPerGame,
    pointsPerGamePercentile: pointsPerGame === null ? null : percentileOf(pointsPerGame, peerPointsPerGame(lines, player.position, rules), "higher"),
    weeks,
    reasons: preseason.reasons,
    // Chip-eligible only (IMPORTANT 3 RULING, fix round; widened Task 8) — every tribal law plus
    // every CONFIRMED discovered one; see `chipEligibleLaws`'s own docblock.
    laws: chipEligibleLaws(registry()),
  };
}
