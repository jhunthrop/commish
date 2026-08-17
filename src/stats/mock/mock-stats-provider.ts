import type { StatsProvider } from "../provider";
import type { Dataset } from "./generate-dataset";
import committed from "./dataset.json" with { type: "json" };

export function createMockStatsProvider(dataset: Dataset = committed as Dataset): StatsProvider {
  return {
    async listPlayers() {
      return dataset.players;
    },
    async getWeeklyStatLines(week) {
      return dataset.statLines.filter((s) => s.week === week);
    },
  };
}
