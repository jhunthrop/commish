import { describe, it, expect } from "vitest";
import { createMockStatsProvider } from "./mock-stats-provider";
import { PLAYER_COUNT } from "./generate-dataset";

describe("MockStatsProvider", () => {
  const provider = createMockStatsProvider();

  it("lists every player", async () => {
    expect(await provider.listPlayers()).toHaveLength(PLAYER_COUNT);
  });
  it("returns one stat line per player for a valid week", async () => {
    const lines = await provider.getWeeklyStatLines(3);
    expect(lines).toHaveLength(PLAYER_COUNT);
    expect(lines.every((l) => l.week === 3)).toBe(true);
  });
  it("returns an empty list for a week outside the season", async () => {
    expect(await provider.getWeeklyStatLines(18)).toEqual([]);
    expect(await provider.getWeeklyStatLines(0)).toEqual([]);
  });
});
