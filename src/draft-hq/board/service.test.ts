import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { boardRows } from "./service";

/**
 * `boardRows` is the one place the stored evidence board (keyed on `nfl_players.id`) is joined
 * back to the product's own player directory (`players`, keyed on the stats provider's id) and
 * recomputed for a league's own shape — real enough machinery (a reverse crosswalk join plus
 * `decide/replacement.ts`'s value/tier math) that it earns a DB-backed test over the seam a unit
 * test of `valueBoard` alone cannot see: does the join actually resolve.
 */
describe("boardRows", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  afterEach(async () => {
    await truncateAll(db);
  });

  async function seedPlayer(input: { readonly id: string; readonly nflId: string; readonly name: string; readonly position: "RB" | "WR" | "QB"; readonly team: string; readonly points: number; readonly rank: number; readonly adp: number | null }): Promise<void> {
    await db.insert(nflPlayers).values({ id: input.nflId, name: input.name, position: input.position });
    await db.insert(players).values({ id: input.id, name: input.name, position: input.position, nflTeam: input.team, adp: input.adp });
    await db.insert(playerCrosswalk).values({ playerId: input.id, nflPlayerId: input.nflId, method: "espn_id", resolvedAt: new Date() });
    await db.insert(preseasonProjections).values({
      season: PRODUCT_SEASON,
      source: BOARD_SOURCE,
      playerId: input.nflId,
      rank: input.rank,
      positionRank: 1,
      projectedPoints: input.points,
      valueOverReplacement: input.points,
      valueRank: input.rank,
      expectedGames: 17,
      floorPoints: input.points - 20,
      medianPoints: input.points,
      ceilingPoints: input.points + 20,
      tier: 0,
      asOf: new Date("2026-08-01T00:00:00Z"),
      momentKind: "live",
    });
  }

  it("joins a stored board back to real players and recomputes value/tier under the given shape", async () => {
    await seedPlayer({ id: "p1", nflId: "00-0000001", name: "Top Back", position: "RB", team: "SF", points: 300, rank: 1, adp: 1.2 });
    await seedPlayer({ id: "p2", nflId: "00-0000002", name: "Second Back", position: "RB", team: "DAL", points: 250, rank: 2, adp: 3.5 });
    await seedPlayer({ id: "p3", nflId: "00-0000003", name: "A Receiver", position: "WR", team: "MIA", points: 280, rank: 3, adp: null });

    const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS }, asOf: new Date("2026-09-04T00:00:00Z") });

    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.rank)).toEqual([1, 2, 3]);
    const topBack = rows.find((row) => row.playerId === "p1");
    expect(topBack?.name).toBe("Top Back");
    expect(topBack?.marketAdp).toBe(1.2);
    expect(topBack?.valueOverReplacement).not.toBeNull();
    // Market edge = ADP minus rank; a player with no ADP reads null rather than a fabricated edge.
    const unlisted = rows.find((row) => row.playerId === "p3");
    expect(unlisted?.marketAdp).toBeNull();
  });

  it("drops a stored row whose player the crosswalk cannot resolve back to the product's own directory", async () => {
    await db.insert(nflPlayers).values({ id: "00-orphan", name: "Ghost Player", position: "RB" });
    await db.insert(preseasonProjections).values({
      season: PRODUCT_SEASON,
      source: BOARD_SOURCE,
      playerId: "00-orphan",
      rank: 1,
      positionRank: 1,
      projectedPoints: 300,
      valueOverReplacement: 300,
      valueRank: 1,
      expectedGames: 17,
      floorPoints: 280,
      medianPoints: 300,
      ceilingPoints: 320,
      tier: 0,
      asOf: new Date("2026-08-01T00:00:00Z"),
      momentKind: "live",
    });

    const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS }, asOf: new Date("2026-09-04T00:00:00Z") });
    expect(rows).toHaveLength(0);
  });

  it("returns nothing when no board has been built for the season yet", async () => {
    const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } });
    expect(rows).toEqual([]);
  });
});
