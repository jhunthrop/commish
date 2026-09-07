import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { nflPlayers, preseasonProjections } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { statMetricName, STAT_LINE_SOURCE } from "@/projections/lines";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { recordObservations } from "@/projections/store";
import { activePeersFor } from "./peers";

const PRIOR_SEASON = PRODUCT_SEASON - 1;

async function seedNflPlayer(db: Db, id: string, name: string, position: "WR" | "RB"): Promise<void> {
  await db.insert(nflPlayers).values({ id, name, position });
}

/** One recorded week for one player in one season, in the point-in-time store's own shape. */
async function seedWeek(db: Db, gsisId: string, season: number): Promise<void> {
  await recordObservations(db, [
    { season, week: 1, playerId: gsisId, source: STAT_LINE_SOURCE, metric: statMetricName("receivingYards"), value: 40, asOf: new Date(Date.UTC(season, 10, 1)) },
  ]);
}

async function seedBoardRow(db: Db, gsisId: string, rank: number): Promise<void> {
  await db.insert(preseasonProjections).values({
    season: PRODUCT_SEASON,
    source: BOARD_SOURCE,
    playerId: gsisId,
    rank,
    positionRank: rank,
    projectedPoints: 200,
    valueOverReplacement: 50,
    valueRank: rank,
    expectedGames: 17,
    floorPoints: 180,
    medianPoints: 200,
    ceilingPoints: 220,
    tier: 0,
    asOf: new Date("2026-08-01T00:00:00Z"),
    momentKind: "live",
  });
}

describe("activePeersFor", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("leaves a retired receiver out of the active population", async () => {
    await seedNflPlayer(db, "00-0000001", "Active Receiver", "WR");
    await seedNflPlayer(db, "00-0000002", "Retired Receiver", "WR");
    await seedWeek(db, "00-0000001", PRIOR_SEASON);
    await seedWeek(db, "00-0000002", 2016);

    const peers = await activePeersFor(db, ["WR"], PRODUCT_SEASON);
    expect([...peers.keys()]).toEqual(["00-0000001"]);
  });

  it("counts a board row as active even for a player with no recorded week yet", async () => {
    await seedNflPlayer(db, "00-0000003", "Drafted Rookie", "WR");
    await seedBoardRow(db, "00-0000003", 1);

    const peers = await activePeersFor(db, ["WR"], PRODUCT_SEASON);
    expect([...peers.keys()]).toEqual(["00-0000003"]);
  });

  it("counts a week from the CURRENT season, not only the prior one", async () => {
    await seedNflPlayer(db, "00-0000004", "In Season Receiver", "WR");
    await seedWeek(db, "00-0000004", PRODUCT_SEASON);

    const peers = await activePeersFor(db, ["WR"], PRODUCT_SEASON);
    expect([...peers.keys()]).toEqual(["00-0000004"]);
  });

  it("answers for the positions asked for and no others", async () => {
    await seedNflPlayer(db, "00-0000005", "Active Receiver", "WR");
    await seedNflPlayer(db, "00-0000006", "Active Back", "RB");
    await seedWeek(db, "00-0000005", PRIOR_SEASON);
    await seedWeek(db, "00-0000006", PRIOR_SEASON);

    expect([...(await activePeersFor(db, ["WR"], PRODUCT_SEASON)).keys()]).toEqual(["00-0000005"]);
    const both = await activePeersFor(db, ["WR", "RB"], PRODUCT_SEASON);
    expect([...both.entries()].sort()).toEqual([
      ["00-0000005", "WR"],
      ["00-0000006", "RB"],
    ]);
  });

  it("asks for nothing and reads nothing when no position is named", async () => {
    expect(await activePeersFor(db, [], PRODUCT_SEASON)).toEqual(new Map());
  });
});
