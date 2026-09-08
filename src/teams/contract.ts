import type { PlayerFactsCoaching, PlayerFactsSchedule } from "@/capsules/facts/types";
import type { Player, Position } from "@/domain/player";
import type { DefenseSeasonFacts } from "@/projections/kdef/season-lines";

/**
 * WHAT THE TEAM PAGE RENDERS (site search round, 2026-09-08). Types only, browser-safe, so the
 * page's client halves (the roster's links, the defense link) import nothing that opens a socket.
 *
 * EVERY SECTION IS NULLABLE AND EVERY NULL IS AN ABSENCE (law 7). A club the store holds no
 * play-by-play for last season has `offense: null`, and the page prints the heading and the word
 * for "not held" under it, never a zero, never a neighbouring season, never a placeholder.
 */

export interface TeamRecord {
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
}

/** Last season, from the schedule store's own results: a record and the points the club allowed.
 *  Points SCORED is not a fact the store holds (the ledger says why), so it is not here. */
export interface TeamLastSeason {
  readonly season: number;
  readonly record: TeamRecord | null;
  readonly pointsAllowed: { readonly points: number; readonly games: number } | null;
}

/** The books' posted regular-season win total for the season being drafted, dated. */
export interface TeamWinTotal {
  readonly season: number;
  readonly line: number;
  /** ISO date (yyyy-mm-dd) of the observation's own `as_of`. */
  readonly asOf: string;
}

/** One situation-neutral figure with its place among the clubs the store holds that season. */
export interface RankedFigure {
  readonly value: number;
  readonly rank: number;
  readonly of: number;
}

export interface TeamOffenseProfile {
  readonly season: number;
  /** Seconds a play; rank 1 is the FASTEST. */
  readonly pace: RankedFigure | null;
  /** Share of situation-neutral plays that were passes; rank 1 throws the most. */
  readonly passRate: RankedFigure | null;
  /** Pass rate over expected, in points; rank 1 throws the most over expectation. */
  readonly passRateOverExpected: RankedFigure | null;
  /** How many neutral plays the three figures rest on. A confidence, not a feature. */
  readonly neutralPlays: number | null;
}

/** One board player on the club, in board order, with the board's own facts. */
export interface TeamBoardPlayer {
  readonly player: Player;
  readonly positionRank: number | null;
  readonly boardRank: number | null;
  readonly projectedPoints: number | null;
  readonly marketAdp: number | null;
  readonly tier: number | null;
}

export interface DepthChartSlot {
  readonly slot: number;
  readonly name: string;
  /** The product's own player id when the universe resolves him, for a link; `null` otherwise. */
  readonly playerId: string | null;
}

export interface DepthChartGroup {
  readonly position: Position;
  readonly slots: readonly DepthChartSlot[];
}

/** A dated chart: the release's own week-one chart, or the harvest's current one. */
export interface DatedDepthChart {
  /** ISO date (yyyy-mm-dd) the chart was published or captured. */
  readonly asOf: string;
  readonly groups: readonly DepthChartGroup[];
}

export interface TeamDepthCharts {
  readonly season: number;
  readonly release: DatedDepthChart | null;
  readonly harvest: DatedDepthChart | null;
}

export interface UsageCount {
  /** The universe id (`nfl_players.id`) the play-by-play attribution is keyed on. */
  readonly nflPlayerId: string;
  /** The product's own player id when the crosswalk resolves him, for a link; `null` otherwise,
   *  and the name renders as plain text rather than a dead link. */
  readonly playerId: string | null;
  readonly name: string;
  readonly count: number;
}

export interface UsageShare extends UsageCount {
  /** The player's count over the club's attributed total, 0..1, four decimals. */
  readonly share: number;
}

/** Last season's top target earners, top rushers and red-zone touch leaders on the club. */
export interface TeamCompetition {
  readonly season: number;
  readonly targets: readonly UsageShare[];
  readonly carries: readonly UsageShare[];
  readonly redZoneTouches: readonly UsageCount[];
}

export interface TeamDefenseSummary {
  readonly season: number;
  /** The defense row's product id, `DST-<code>`, the one its analysis page takes. */
  readonly playerId: string;
  readonly points: number;
  readonly games: number;
  readonly pointsPerGame: number;
  readonly facts: DefenseSeasonFacts;
  /** Its place in the ADP order among defenses on the board, or `null` when unpriced. */
  readonly adpRank: number | null;
  readonly scoringLabel: string;
}

export interface TeamPageData {
  readonly code: string;
  readonly city: string;
  readonly nickname: string;
  readonly byeWeek: number | null;
  readonly season: number;
  readonly lastSeason: TeamLastSeason | null;
  readonly winTotal: TeamWinTotal | null;
  readonly coaching: PlayerFactsCoaching | null;
  readonly offense: TeamOffenseProfile | null;
  readonly players: readonly TeamBoardPlayer[];
  readonly depthCharts: TeamDepthCharts | null;
  readonly competition: TeamCompetition | null;
  readonly schedule: PlayerFactsSchedule | null;
  readonly defense: TeamDefenseSummary | null;
}

export function teamDisplayName(data: Pick<TeamPageData, "city" | "nickname">): string {
  return `${data.city} ${data.nickname}`;
}
