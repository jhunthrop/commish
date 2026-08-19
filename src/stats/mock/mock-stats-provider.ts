import type { StatLine } from "@/domain/player";
import type { GameStatus, GameSummary, StatsProvider } from "../provider";
import type { Dataset } from "./generate-dataset";
import { deriveMockGames } from "./games";
import committed from "./dataset.json" with { type: "json" };

export interface MockProviderOptions {
  /**
   * Which week, if any, is treated as still being played. Every other week is `final`.
   *
   * The dataset is a finished season, so without this the mock can never exercise a live state
   * and a developer with no API key could never see the live surfaces at all. It is
   * configuration (`MOCK_STATS_LIVE_WEEK`), not a default: leaving it unset keeps the mock
   * byte-identical in behavior to what Plan A shipped.
   */
  readonly liveWeek?: number;
}

export function createMockStatsProvider(dataset: Dataset = committed as Dataset, options: MockProviderOptions = {}): StatsProvider {
  const linesFor = (week: number): readonly StatLine[] => dataset.statLines.filter((line) => line.week === week);
  const statusFor = (week: number): GameStatus => (week === options.liveWeek ? "in_progress" : "final");
  const gamesFor = (week: number): readonly GameSummary[] =>
    deriveMockGames(week, dataset.players, linesFor(week), statusFor(week));

  return {
    async listPlayers() {
      return dataset.players;
    },
    async listGames(week) {
      return gamesFor(week);
    },
    async getGameStatLines(game) {
      const teams = new Set([game.homeNflTeam, game.awayNflTeam]);
      const teamById = new Map(dataset.players.map((player) => [player.id, player.nflTeam]));
      return linesFor(game.week).filter((line) => teams.has(teamById.get(line.playerId) ?? ""));
    },
    async getWeeklyStatLines(week) {
      // Composed, not filtered independently: the contract asserts these agree, and the cheapest
      // way to keep them agreeing forever is for one of them to BE the other.
      const games = gamesFor(week);
      const teams = new Set(games.flatMap((game) => [game.homeNflTeam, game.awayNflTeam]));
      const teamById = new Map(dataset.players.map((player) => [player.id, player.nflTeam]));
      return linesFor(week).filter((line) => teams.has(teamById.get(line.playerId) ?? ""));
    },
  };
}
