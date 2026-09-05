import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { captureSnapshots, nflPlayers, playerCrosswalk, players, playerStatLines, preseasonProjections, statWeeks } from "@/db/schema";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { createTestDb, truncateAll } from "@/db/test-db";
import { collectAllPlayerFacts } from "./collect";

async function seedPlayer(db: Db, input: { readonly id: string; readonly nflId: string; readonly name: string; readonly position: "RB" | "WR" | "QB"; readonly team: string; readonly points: number; readonly rank: number; readonly adp: number | null }): Promise<void> {
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

describe("collectAllPlayerFacts", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("returns no facts when the board is empty", async () => {
    expect(await collectAllPlayerFacts(db)).toEqual([]);
  });

  it("builds one honest fact sheet per board-ranked player, with no season summary before any week is played", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-0000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });

    const facts = await collectAllPlayerFacts(db);
    expect(facts).toHaveLength(1);
    const rashad = facts[0]!;
    expect(rashad.identity).toEqual({ id: "p1", name: "Rashad Long", position: "RB", team: "SF" });
    expect(rashad.market.adp).toBe(12.5);
    expect(rashad.projection.projectedPoints).toBe(248);
    expect(rashad.season).toBeNull();
    // THE TRI-STATE (fix round 1, CRITICAL 2): no injury snapshot has ever been captured in this
    // test's own database, so the honest read is "unknown" — NEVER a healthy claim, which would
    // be indistinguishable from a real snapshot that actually checked and found nothing.
    expect(rashad.injury).toEqual({ state: "unknown" });
    expect(rashad.news).toEqual([]);
  });

  it("attaches a designated player's status and capture instant, and a genuinely clean read for a player the feed checked and did not name", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-0000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await seedPlayer(db, { id: "p2", nflId: "00-0000002", name: "Healthy Back", position: "RB", team: "DAL", points: 200, rank: 2, adp: 20 });
    const capturedAt = new Date("2026-09-01T12:00:00Z");
    await db.insert(captureSnapshots).values({ source: "tank01_injuries_by_date", capturedAt, digest: "d1", payload: { injDate: "20260901", injList: [{ playerID: "p1", designation: "Q" }] } });

    const facts = await collectAllPlayerFacts(db);
    const rashad = facts.find((f) => f.identity.id === "p1")!;
    const healthy = facts.find((f) => f.identity.id === "p2")!;
    expect(rashad.injury).toEqual({ state: "designated", designation: "Q", asOf: capturedAt.toISOString() });
    // A snapshot DID run and did not name him — a genuine, dated "clean" read, distinct from
    // "unknown" (see the previous test): the snapshot's own presence is what licenses this.
    expect(healthy.injury).toEqual({ state: "clean", asOf: capturedAt.toISOString() });
  });

  it("attaches up to three recent headlines by name, from one shared snapshot read", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-0000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await db.insert(captureSnapshots).values({
      source: "tank01_news",
      capturedAt: new Date(),
      digest: "d1",
      payload: [{ title: "Rashad Long: limited in practice", link: "https://example.com/1", date: "2026-09-02" }],
    });

    const facts = await collectAllPlayerFacts(db);
    expect(facts[0]!.news).toEqual([{ title: "Rashad Long: limited in practice", link: "https://example.com/1", publishedAt: "2026-09-02" }]);
  });

  it("builds a real season summary once a week has been played, under standard PPR scoring", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-0000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await db.insert(statWeeks).values({ week: 1, status: "final" });
    await db.insert(playerStatLines).values({ playerId: "p1", week: 1, rushingYards: 100, rushingTouchdowns: 1, receptions: 3, receivingYards: 20, carries: 18, targets: 4 });

    const facts = await collectAllPlayerFacts(db);
    const rashad = facts[0]!;
    expect(rashad.season).not.toBeNull();
    expect(rashad.season?.gamesPlayed).toBe(1);
    expect(rashad.season?.totals.carries).toBe(18);
    expect(rashad.season?.totals.touchdowns).toBe(1);
  });

  it("never lets a scheduled (not-yet-played) week's stat line count toward the season summary", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-0000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await db.insert(statWeeks).values({ week: 1, status: "scheduled" });
    await db.insert(playerStatLines).values({ playerId: "p1", week: 1, rushingYards: 100, rushingTouchdowns: 1 });

    const facts = await collectAllPlayerFacts(db);
    expect(facts[0]!.season).toBeNull();
  });
});
