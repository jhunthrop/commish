import type { StatLine } from "@research/domain/player";
import { PPR_SCORING } from "@research/domain/scoring";
import { computeFantasyPoints } from "@research/scoring";
import type { AdpEntry, GameStatus, GameSummary, StatsProvider } from "../provider";
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
  const teamById = new Map(dataset.players.map((player) => [player.id, player.nflTeam]));

  /**
   * A deterministic ADP for the fixed dataset: every player, ranked by PPR season total (best =
   * 1), ties broken by id so the order is total. Derived, not stored in `dataset.json`, so a
   * dataset regeneration can never leave the two out of agreement — and PPR on purpose: an ADP
   * feed is one market-wide consensus, not a per-league ranking, and PPR is the product's
   * default scoring (`PPR_SCORING` is what `rankedPlayers` falls back to). Whole numbers 1..N
   * where a real feed publishes fractional averages — both satisfy the contract, and integers
   * keep the mock's ordering trivially auditable in a test.
   */
  function listAdpEntries(): readonly AdpEntry[] {
    const totals = new Map<string, number>();
    const positionById = new Map(dataset.players.map((player) => [player.id, player.position]));
    for (const line of dataset.statLines) {
      const position = positionById.get(line.playerId);
      // A stat line for a player the dataset does not list ranks nobody. Unreachable with the
      // committed dataset (generateDataset only ever writes lines for its own players); kept for
      // a caller-supplied dataset, which this factory accepts.
      if (position === undefined) continue;
      totals.set(line.playerId, (totals.get(line.playerId) ?? 0) + computeFantasyPoints(line, position, PPR_SCORING));
    }
    return [...dataset.players]
      .sort((a, b) => {
        const diff = (totals.get(b.id) ?? 0) - (totals.get(a.id) ?? 0);
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      })
      .map((player, index) => ({ playerId: player.id, adp: index + 1 }));
  }

  async function listGames(week: number): Promise<readonly GameSummary[]> {
    return deriveMockGames(week, dataset.players, linesFor(week), statusFor(week));
  }

  async function getGameStatLines(game: GameSummary): Promise<readonly StatLine[]> {
    const teams = new Set([game.homeNflTeam, game.awayNflTeam]);
    return linesFor(game.week).filter((line) => teams.has(teamById.get(line.playerId) ?? ""));
  }

  return {
    // Every answer comes out of a committed JSON file. Nothing here reaches a network.
    requestCost: "free",
    // Derived from the dataset rather than declared beside it: `generateDataset`'s SEASON_WEEKS
    // and a hand-written constant here would be two expressions of one fact, and the committed
    // `dataset.json` is what actually ships. A caller passing its own dataset gets its own bound.
    lastWeekOfSeason: dataset.statLines.reduce((last, line) => Math.max(last, line.week), 0),

    async listPlayers() {
      return dataset.players;
    },

    listGames,

    getGameStatLines,

    async getWeeklyStatLines(week) {
      // Composed, not filtered independently: the contract asserts these agree, and the cheapest
      // way to keep them agreeing forever is for one of them to BE the other. In-memory, so a
      // plain sequential loop (no Promise.all) is fine — there is no request cost to parallelize.
      const lines: StatLine[] = [];
      for (const game of await listGames(week)) {
        lines.push(...(await getGameStatLines(game)));
      }
      return lines;
    },

    async listAdp() {
      return listAdpEntries();
    },
  };
}
