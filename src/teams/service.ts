import { desc, eq } from "drizzle-orm";
import { coachingFor } from "@/capsules/facts/coaching";
import { namesFor, readPlayCallerTable, scheduledGamesFor, teamMetricRowsFor } from "@/capsules/facts/depth-reads";
import { scheduleFor } from "@/capsules/facts/schedule";
import type { Db } from "@/db/client";
import { captureSnapshots, playerCrosswalk, players } from "@/db/schema";
import { NFL_TEAM_NAMES } from "@/domain/nfl-team-names";
import type { Position } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { genericBoardRows } from "@/draft-hq/board/generic-board";
import type { BoardRow } from "@/draft-hq/board/service";
import { byeWeeksByTeam } from "@/league-service/nfl-schedule";
import { createTtlMemo } from "@/lib/cache/ttl-memo";
import { kdefSeasonLines } from "@/projections/kdef/season-lines";
import { PBP_PLAYER_SOURCE } from "@/projections/nflverse/pbp-players";
import { PBP_SOURCE } from "@/projections/nflverse/pbp";
import { SCHEDULE_SOURCE } from "@/projections/nflverse/schedule";
import { productTeamCode, sourceTeamCode } from "@/projections/nflverse/team-codes";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { DEPTH_METRIC, DEPTH_SOURCE } from "@/projections/preseason/depth";
import { BOARD_REASONS_MEMO_TTL_MS } from "@/projections/preseason/reasons-by-player";
import { LAST_POSSIBLE_WEEK, observationsAsOf } from "@/projections/store";
import { playerTeamsAsOf, teamObservationsAsOf } from "@/projections/team-store";
import { VEGAS_METRICS, VEGAS_SOURCE } from "@/projections/vegas/ingest";
import { TANK01_CONFIG } from "@/stats/tank01/config";
import { competitionFor } from "./competition";
import type { TeamBoardPlayer, TeamDefenseSummary, TeamDepthCharts, TeamOffenseProfile, TeamPageData } from "./contract";
import { depthChartFor, harvestListingsFor, type DepthListing } from "./depth-chart";
import { offenseProfilesFor } from "./offense-profile";
import { lastSeasonFor, winTotalFor } from "./record";

/**
 * THE TEAM PAGE'S ONE READ (site search round, 2026-09-08): every section the coordinator
 * ruled, from the stores the fact-sheet round already reads, memoized per club at the board's
 * cadence so a page hit on a warm instance costs no statement.
 *
 * READERS ARE REUSED, NEVER DUPLICATED: the team-week rows, the play-caller table, the schedule
 * and the names come through `capsules/facts/depth-reads.ts`; the coaching and schedule facts
 * through their own builders; the defense line through `kdefSeasonLines`; the board through
 * `genericBoardRows`. What is new is the assembly and the four pure builders beside this file.
 *
 * THREE SHARED MEMOS BESIDE THE PER-CLUB ONE, because three reads are league-wide by nature: the
 * offense profile (a rank among 32 needs all 32), the prior season's player-team placements (one
 * table, every club), and the harvest's newest depth-chart capture (one payload, every club).
 *
 * TWO SPELLINGS OF EVERY CLUB, folded the way `collect-depth.ts` folds them: the product code for
 * `players`, `nfl_games` and the harvest; the source code for `team_week_observations`,
 * `player_week_teams` and the play-caller table.
 */

const HARVEST_DEPTH_SOURCE = "tank01_depth_charts";
const OFFENSE_KEY = "offense";
const PLACEMENTS_KEY = "placements";
const HARVEST_KEY = "harvest";

/** The season the record, the profile, the competition and the defense line describe. */
export const TEAM_PRIOR_SEASON = PRODUCT_SEASON - 1;

/** The scoring the defense line is measured under, named on the page. */
const DEFENSE_SCORING_LABEL = "PPR";

const pageMemo = createTtlMemo<TeamPageData | null>(BOARD_REASONS_MEMO_TTL_MS);
const offenseMemo = createTtlMemo<ReadonlyMap<string, TeamOffenseProfile>>(BOARD_REASONS_MEMO_TTL_MS);
const placementsMemo = createTtlMemo<ReadonlyMap<string, string>>(BOARD_REASONS_MEMO_TTL_MS);
const harvestMemo = createTtlMemo<{ readonly capturedAt: Date; readonly payload: unknown } | null>(BOARD_REASONS_MEMO_TTL_MS);

/** The 32 clubs' prior-season profiles, ranked against each other, once per instance. */
function offenseProfiles(db: Db, asOf: Date): Promise<ReadonlyMap<string, TeamOffenseProfile>> {
  return offenseMemo.get(OFFENSE_KEY, async () => {
    const rowsByTeam = await teamMetricRowsFor(db, TEAM_PRIOR_SEASON, { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, PBP_SOURCE);
    return offenseProfilesFor(TEAM_PRIOR_SEASON, rowsByTeam);
  });
}

/** Which club each player belonged to last season: the club he played the most weeks for, the
 *  identical rule `seasonTargetsFor` keeps. Keyed by nflverse id, valued in the source spelling. */
function priorSeasonPlacements(db: Db, asOf: Date): Promise<ReadonlyMap<string, string>> {
  return placementsMemo.get(PLACEMENTS_KEY, async () => {
    const rows = await playerTeamsAsOf(db, { season: TEAM_PRIOR_SEASON, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf });
    const weeksByTeam = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const counts = weeksByTeam.get(row.playerId) ?? new Map<string, number>();
      counts.set(row.team, (counts.get(row.team) ?? 0) + 1);
      weeksByTeam.set(row.playerId, counts);
    }
    const out = new Map<string, string>();
    for (const [playerId, counts] of weeksByTeam) out.set(playerId, [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0]);
    return out;
  });
}

/** The newest harvest depth-chart capture, or `null` when none has been taken. */
function newestHarvestChart(db: Db): Promise<{ readonly capturedAt: Date; readonly payload: unknown } | null> {
  return harvestMemo.get(HARVEST_KEY, async () => {
    const [row] = await db
      .select({ capturedAt: captureSnapshots.capturedAt, payload: captureSnapshots.payload })
      .from(captureSnapshots)
      .where(eq(captureSnapshots.source, HARVEST_DEPTH_SOURCE))
      .orderBy(desc(captureSnapshots.capturedAt))
      .limit(1);
    return row === undefined ? null : { capturedAt: row.capturedAt, payload: row.payload };
  });
}

/** The club's rows on the served board, in board order, narrowed to what the roster prints. */
function boardPlayersFor(rows: readonly BoardRow[], code: string): readonly TeamBoardPlayer[] {
  return rows
    .filter((row) => row.team === code)
    .map((row) => ({
      player: { id: row.playerId, name: row.name, position: row.position, nflTeam: row.team, headshotUrl: row.headshotUrl, adp: row.marketAdp },
      positionRank: row.positionRankInValue ?? row.marketOrderRank,
      boardRank: row.overallRank,
      projectedPoints: row.projectedPoints,
      marketAdp: row.marketAdp,
      tier: row.tier,
    }));
}

/** One club's roster in both id spaces: the product row, and the universe id when crosswalked. */
async function clubRoster(db: Db, code: string): Promise<readonly { readonly playerId: string; readonly nflPlayerId: string | null; readonly name: string; readonly position: Position }[]> {
  return db
    .select({ playerId: players.id, nflPlayerId: playerCrosswalk.nflPlayerId, name: players.name, position: players.position })
    .from(players)
    .leftJoin(playerCrosswalk, eq(playerCrosswalk.playerId, players.id))
    .where(eq(players.nflTeam, code));
}

/** The release's week-one chart for the club, joined to the product's own directory for names. */
async function releaseListings(db: Db, roster: Awaited<ReturnType<typeof clubRoster>>, asOf: Date): Promise<{ readonly asOf: Date | null; readonly listings: readonly DepthListing[] }> {
  const ids = roster.flatMap((row) => (row.nflPlayerId === null ? [] : [row.nflPlayerId]));
  if (ids.length === 0) return { asOf: null, listings: [] };
  const slots = await observationsAsOf(db, { season: PRODUCT_SEASON, week: 1, asOf, source: DEPTH_SOURCE, playerIds: ids });
  const byNflId = new Map(roster.map((row) => [row.nflPlayerId, row] as const));
  let stamped: Date | null = null;
  const listings = slots.flatMap((slot) => {
    const row = byNflId.get(slot.playerId);
    if (slot.metric !== DEPTH_METRIC || row === undefined) return [];
    if (stamped === null || slot.asOf > stamped) stamped = slot.asOf;
    return [{ position: row.position, slot: slot.value, name: row.name, playerId: row.playerId }];
  });
  return { asOf: stamped, listings };
}

async function depthChartsFor(db: Db, code: string, roster: Awaited<ReturnType<typeof clubRoster>>, asOf: Date): Promise<TeamDepthCharts | null> {
  const [release, harvest] = await Promise.all([releaseListings(db, roster, asOf), newestHarvestChart(db)]);
  const releaseChart = release.asOf === null ? null : depthChartFor(release.asOf, release.listings);
  const harvestChart = harvest === null ? null : depthChartFor(harvest.capturedAt, harvestListingsFor(harvest.payload, code));
  return releaseChart === null && harvestChart === null ? null : { season: PRODUCT_SEASON, release: releaseChart, harvest: harvestChart };
}

async function competitionSection(db: Db, sourceCode: string, asOf: Date) {
  const placements = await priorSeasonPlacements(db, asOf);
  const playerIds = [...placements].filter(([, team]) => team === sourceCode).map(([playerId]) => playerId);
  if (playerIds.length === 0) return null;
  const [rows, names] = await Promise.all([
    observationsAsOf(db, { season: TEAM_PRIOR_SEASON, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf, source: PBP_PLAYER_SOURCE, playerIds }),
    namesFor(db, playerIds),
  ]);
  return competitionFor(TEAM_PRIOR_SEASON, rows, names);
}

async function defenseSection(db: Db, code: string, board: readonly BoardRow[]): Promise<TeamDefenseSummary | null> {
  const playerId = `${TANK01_CONFIG.defensePlayerIdPrefix}${code}`;
  const line = (await kdefSeasonLines(db, { season: TEAM_PRIOR_SEASON, playerIds: [playerId], rules: PPR_SCORING })).get(playerId);
  if (line === undefined || line.facts.kind !== "DEF") return null;
  return {
    season: line.season,
    playerId,
    points: line.points,
    games: line.games,
    pointsPerGame: line.pointsPerGame,
    facts: line.facts,
    adpRank: board.find((row) => row.playerId === playerId)?.marketOrderRank ?? null,
    scoringLabel: DEFENSE_SCORING_LABEL,
  };
}

async function readTeamPage(db: Db, code: string): Promise<TeamPageData | null> {
  const names = NFL_TEAM_NAMES[code];
  if (names === undefined) return null;
  const asOf = new Date();
  const sourceCode = sourceTeamCode(code);
  const priorWindow = { from: 1, to: LAST_POSSIBLE_WEEK } as const;
  const [board, byes, roster, profiles, kickoffRows, vegasRows, games, competition] = await Promise.all([
    genericBoardRows(db),
    byeWeeksByTeam(db),
    clubRoster(db, code),
    offenseProfiles(db, asOf),
    teamMetricRowsFor(db, TEAM_PRIOR_SEASON, priorWindow, asOf, SCHEDULE_SOURCE.kickoff),
    teamObservationsAsOf(db, { season: PRODUCT_SEASON, week: 1, asOf, source: VEGAS_SOURCE }),
    scheduledGamesFor(db),
    competitionSection(db, sourceCode, asOf),
  ]);
  const [depthCharts, defense] = await Promise.all([depthChartsFor(db, code, roster, asOf), defenseSection(db, code, board)]);
  return {
    code,
    city: names.city,
    nickname: names.nickname,
    byeWeek: byes.get(code) ?? null,
    season: PRODUCT_SEASON,
    lastSeason: lastSeasonFor(TEAM_PRIOR_SEASON, kickoffRows.get(sourceCode) ?? []),
    winTotal: winTotalFor(PRODUCT_SEASON, vegasRows.filter((row) => row.team === sourceCode), VEGAS_METRICS.winTotal),
    coaching: coachingFor(sourceCode, PRODUCT_SEASON, readPlayCallerTable()),
    offense: profiles.get(sourceCode) ?? null,
    players: boardPlayersFor(board, code),
    depthCharts,
    competition,
    schedule: scheduleFor(productTeamCode(sourceCode), games, new Map()),
    defense,
  };
}

/** The page for one PRODUCT team code, from memory after the first read; `null` for a code the
 *  name table does not hold. */
export function teamPage(db: Db, code: string): Promise<TeamPageData | null> {
  return pageMemo.get(code, () => readTeamPage(db, code));
}
