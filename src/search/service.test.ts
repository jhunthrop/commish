import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { countingDb, createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { nflGames, playerCrosswalk, players } from "@research-ts/db/schema";
import type { BoardEntry } from "@research-ts/projections/preseason/board";
import { BOARD_SOURCE, writePreseasonBoard } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { recordNflPlayers } from "@research-ts/projections/universe";
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

  it("sees a re-persisted board on the next search, not within the hour: the write clears the index memo", async () => {
    expect((await siteSearch(base, "chase")).results).toEqual([]);
    const CHASE_NFL = "00-0036900";
    await recordNflPlayers(base, [{ id: CHASE_NFL, pfrId: null, espnId: "4362628", name: "Ja'Marr Chase", position: "WR", latestTeam: "CIN", rookieSeason: 2021, lastSeason: PRODUCT_SEASON - 1 }]);
    await base.insert(players).values({ id: "4362628", name: "Ja'Marr Chase", position: "WR", nflTeam: "CIN", adp: 1.2 });
    await base.insert(playerCrosswalk).values({ playerId: "4362628", nflPlayerId: CHASE_NFL, method: "espn_id", resolvedAt: new Date() });
    const entry: BoardEntry = {
      playerId: CHASE_NFL, position: "WR", projectedPoints: 326.4, valueOverReplacement: 141.2, positionRank: 1, replacementLevel: 185.2, rank: 1, valueRank: 1,
      team: "CIN", expectedGames: 16.2, seasonLine: { playerId: CHASE_NFL, week: 0 } as BoardEntry["seasonLine"], outlook: { floor: 261.1, median: 326.4, ceiling: 359.0 },
      tier: 0, playersLeftInTier: 4, dropToNextTier: 18.3, reasons: [],
    };
    await writePreseasonBoard(base, { season: PRODUCT_SEASON, source: BOARD_SOURCE, asOf: new Date("2026-08-01T00:00:00.000Z"), momentKind: "live" }, [entry]);
    const found = (await siteSearch(base, "chase")).results;
    expect(found.map((result) => (result.kind === "player" ? result.player.id : result.code))).toEqual(["4362628"]);
  });

  it("reports the index size for the measurement", async () => {
    const index = await siteSearchIndex(base);
    // Two priced rows plus the 32 team entities.
    expect(index.size).toBe(34);
  });
});
