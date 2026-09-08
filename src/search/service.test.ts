import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import { nflGames, players } from "@/db/schema";
import { siteSearch, siteSearchIndex } from "./service";

/**
 * The service over a REAL database: the memo bargain is the whole point of the file, and a stub
 * cannot show that the second search issues no statement. The universe here is the market-order
 * half of the board (a priced kicker and a priced defense) because that half needs no projections
 * generation to seed; the projected half rides the same `boardRows` read `service.test.ts` in
 * `draft-hq/board` already proves.
 */
const base = createTestDb();

beforeEach(async () => {
  await truncateAll(base);
  await base.insert(players).values([
    { id: "k-bates", name: "Jake Bates", position: "K", nflTeam: "DET", adp: 140.5, posAdp: "K1" },
    { id: "DST-DET", name: "Detroit Lions", position: "DEF", nflTeam: "DET", adp: 150.2, posAdp: "DEF4" },
    { id: "unpriced-k", name: "Nobody Priced", position: "K", nflTeam: "CIN", adp: null },
  ]);
  const schedule = Array.from({ length: 14 }, (_, index) => index + 1)
    .filter((week) => week !== 8)
    .map((week) => ({ gameId: `g${week}`, week, homeNflTeam: "DET", awayNflTeam: "CIN", status: "scheduled" as const }));
  await base.insert(nflGames).values(schedule);
});

afterAll(async () => {
  await truncateAll(base);
});

describe("siteSearch", () => {
  it("answers from the board and the team table, with the ingested bye on both", async () => {
    const body = await siteSearch(base, "lions");
    expect(body.query).toBe("lions");
    expect(body.results.map((result) => (result.kind === "team" ? `team:${result.code}` : result.player.id))).toEqual(["team:DET", "DST-DET", "k-bates"]);
    const [team, defense] = body.results;
    expect(team).toEqual({ kind: "team", code: "DET", name: "Detroit Lions", byeWeek: 8 });
    expect(defense).toMatchObject({ kind: "player", positionRank: 1, boardRank: null, byeWeek: 8 });
  });

  it("leaves an unpriced player out, exactly as the board does", async () => {
    const body = await siteSearch(base, "nobody");
    expect(body.results).toEqual([]);
  });

  it("says nothing matches with an empty list, never a placeholder row", async () => {
    const body = await siteSearch(base, "zzq");
    expect(body.results).toEqual([]);
  });

  it("issues no database statement on a warm instance", async () => {
    const counted = countingDb(base);
    await siteSearchIndex(counted.db);
    const warm = countingDb(base);
    await siteSearch(warm.db, "det");
    await siteSearch(warm.db, "bates");
    expect(warm.selectCount()).toBe(0);
  });

  it("reports the index size for the measurement", async () => {
    const index = await siteSearchIndex(base);
    // Two priced rows plus the 32 team entities.
    expect(index.size).toBe(34);
  });
});
