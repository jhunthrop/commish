import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, preseasonBoardReasons, preseasonProjections } from "@/db/schema";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { evidencePoolFor } from "./evidence";

/**
 * THE ADVISOR'S AND THE SIMULATOR'S EVIDENCE POOL, under the roster-status gate (founder report
 * 2026-09-08): a player the gate took off the board has NO projection row, only a `roster_status`
 * reason, so he can never enter the pool — and therefore never the advisor's candidates, its
 * survival odds or its tier counts, all of which are computed over this pool alone.
 */
describe("evidencePoolFor under the roster-status gate", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  async function seedProduct(id: string, nflId: string, name: string, adp: number): Promise<void> {
    await db.insert(nflPlayers).values({ id: nflId, name, position: "RB" });
    await db.insert(players).values({ id, name, position: "RB", nflTeam: "KC", adp });
    await db.insert(playerCrosswalk).values({ playerId: id, nflPlayerId: nflId, method: "espn_id", resolvedAt: new Date() });
  }

  it("holds the ranked player and never the excluded one, whose only stored row is his status", async () => {
    await seedProduct("star", "00-0000001", "Star Back", 1.5);
    await seedProduct("squad", "00-0000002", "Squad Back", 240.5);
    await db.insert(preseasonProjections).values({
      season: PRODUCT_SEASON,
      source: BOARD_SOURCE,
      playerId: "00-0000001",
      rank: 1,
      positionRank: 1,
      projectedPoints: 300,
      valueOverReplacement: 150,
      valueRank: 1,
      expectedGames: 17,
      floorPoints: 250,
      medianPoints: 300,
      ceilingPoints: 350,
      tier: 0,
      asOf: new Date("2026-09-08T00:00:00.000Z"),
      momentKind: "live",
    });
    await db.insert(preseasonBoardReasons).values({
      season: PRODUCT_SEASON,
      source: BOARD_SOURCE,
      playerId: "00-0000002",
      code: "roster_status",
      detail: "",
      payload: { status: "practice_squad", source: "nflverse_roster_week_1", observedAt: "2026-09-01T00:00:00.000Z", team: "NO" },
    });

    const { pool } = await evidencePoolFor(db, new Date("2026-09-09T00:00:00.000Z"));
    expect(pool.map((entry) => entry.playerId)).toEqual(["star"]);
  });
});
