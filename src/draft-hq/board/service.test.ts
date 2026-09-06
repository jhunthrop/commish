import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { valueOrderFor } from "@/draft-service/sim/value-order";
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
    // VALUE ordering (founder ruling 2026-09-04): the WR's 280 points clear the WR replacement
    // line by more than the second RB's 250 clear the RB line, so the served order flips the
    // raw points-rank order — QBs stop crowning the board for the same reason. `rank` stays the
    // stored points-rank provenance; `overallRank` is the served, value-ordered rank.
    expect(rows.map((row) => row.name)).toEqual(["Top Back", "A Receiver", "Second Back"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 3, 2]);
    expect(rows.map((row) => row.overallRank)).toEqual([1, 2, 3]);
    for (let i = 1; i < rows.length; i += 1) {
      expect((rows[i - 1]!.valueRank ?? Infinity) <= (rows[i]!.valueRank ?? Infinity)).toBe(true);
    }
    const topBack = rows.find((row) => row.playerId === "p1");
    expect(topBack?.name).toBe("Top Back");
    expect(topBack?.marketAdp).toBe(1.2);
    expect(topBack?.valueOverReplacement).not.toBeNull();
    // Market edge = ADP minus rank; a player with no ADP reads null rather than a fabricated edge.
    const unlisted = rows.find((row) => row.playerId === "p3");
    expect(unlisted?.marketAdp).toBeNull();
  });

  it("breaks an exact value tie by the market's order, and the badges follow the served order", async () => {
    // Founder audit 2026-09-04: two RBs identical in points and value were split by a sort
    // artifact against the market. The earlier ADP now leads the tie, and wears the 1 badge.
    await seedPlayer({ id: "t1", nflId: "00-0000011", name: "Later Market Back", position: "RB", team: "ATL", points: 200, rank: 1, adp: 4.2 });
    await seedPlayer({ id: "t2", nflId: "00-0000012", name: "Earlier Market Back", position: "RB", team: "DET", points: 200, rank: 2, adp: 2.5 });
    const rows = await boardRows(db, { shape: { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS }, asOf: new Date("2026-09-04T00:00:00Z") });
    const names = rows.filter((row) => row.position === "RB").map((row) => row.name);
    expect(names).toEqual(["Earlier Market Back", "Later Market Back"]);
    const earlier = rows.find((row) => row.name === "Earlier Market Back");
    const later = rows.find((row) => row.name === "Later Market Back");
    expect(earlier?.positionRankInValue).toBe(1);
    expect(later?.positionRankInValue).toBe(2);
  });

  it("hands the Simulator the identical order it serves, tie by the market included", async () => {
    // The Board and the Simulator sit side by side on one screen, so they share ONE comparator
    // (`compareBoardOrder`). Two backs identical to the hundredth in points, and therefore in
    // value, with the earlier ADP belonging to the LATER player id: only the market can separate
    // them, and both surfaces have to separate them the same way.
    const SHAPE = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };
    const tied = [
      { id: "s1", nflId: "00-0000021", name: "Later Market", points: 210.55, rank: 1, adp: 6.4 },
      { id: "s2", nflId: "00-0000022", name: "Earlier Market", points: 210.55, rank: 2, adp: 3.1 },
    ] as const;
    for (const row of tied) {
      await seedPlayer({ ...row, position: "RB", team: "ATL" });
    }
    await seedPlayer({ id: "s3", nflId: "00-0000023", name: "Best Back", position: "RB", team: "SF", points: 320, rank: 3, adp: 1.1 });

    const rows = await boardRows(db, { shape: SHAPE, asOf: new Date("2026-09-04T00:00:00Z") });
    const boardOrder = rows.map((row) => row.playerId);
    expect(boardOrder).toEqual(["s3", "s2", "s1"]);

    // The sim reads the same players out of `evidencePoolFor`'s own shape: points plus a market
    // RANK rather than an ADP, which agrees with the ADP on order and is all a tiebreak reads.
    const simOrder = valueOrderFor(
      rows.map((row) => ({ playerId: row.playerId, position: row.position, projectedPoints: row.projectedPoints, marketRank: row.marketAdp })),
      SHAPE,
    ).map((entry) => entry.playerId);
    expect(simOrder).toEqual(boardOrder);
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
