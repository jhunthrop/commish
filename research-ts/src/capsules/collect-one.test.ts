import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research-ts/db/client";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@research-ts/db/schema";
import { statMetricName, STAT_LINE_SOURCE } from "@research-ts/projections/lines";
import { NFLVERSE_SOURCE, PARTICIPATION_METRICS } from "@research-ts/projections/nflverse/map";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { recordObservations, type PlayerWeekObservation } from "@research-ts/projections/store";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { collectAllPlayerFacts } from "./collect";
import { collectPlayerFacts } from "./collect-one";

const PRIOR_SEASON = PRODUCT_SEASON - 1;

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

/** One prior-season week, the same shape `collect.test.ts` seeds ranked color facts from. */
function priorSeasonWeek(gsisId: string, weekNumber: number, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(PRIOR_SEASON, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season: PRIOR_SEASON, week: weekNumber, playerId: gsisId, source: STAT_LINE_SOURCE, metric: statMetricName(field), value, asOf,
  }));
}

function participationRow(gsisId: string, weekNumber: number, source: string, metric: string, value: number): PlayerWeekObservation {
  return { season: PRIOR_SEASON, week: weekNumber, playerId: gsisId, source, metric, value, asOf: new Date(Date.UTC(PRIOR_SEASON, 10, 1)) };
}

describe("collectPlayerFacts", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("returns null for a player the board never ranked", async () => {
    expect(await collectPlayerFacts(db, "nobody")).toBeNull();
  });

  it("returns null for a player who exists in the product but was never crosswalked to the board", async () => {
    await db.insert(players).values({ id: "p-uncrosswalked", name: "Ghost Player", position: "RB", nflTeam: "SF" });
    expect(await collectPlayerFacts(db, "p-uncrosswalked")).toBeNull();
  });

  it("matches collectAllPlayerFacts' own entry for a board-ranked player, factsHash included", async () => {
    // Two RBs so ranked color facts (last season's story, usage, trend) have a real peer to rank
    // against — a single-player population would rank everyone first-of-one, which would not
    // exercise the shared ranking helpers this collector reuses from collect.ts.
    await seedPlayer(db, { id: "p1", nflId: "00-9000001", name: "Rashad Long", position: "RB", team: "SF", points: 248, rank: 1, adp: 12.5 });
    await seedPlayer(db, { id: "p2", nflId: "00-9000002", name: "Peer Back", position: "RB", team: "DAL", points: 150, rank: 2, adp: 40 });
    // A third player at a DIFFERENT position — present so a scoping bug that accidentally widens
    // (or narrows) the ranking population across positions would be caught by a mismatch.
    await seedPlayer(db, { id: "p3", nflId: "00-9000003", name: "Other Position", position: "WR", team: "NYJ", points: 120, rank: 3, adp: 60 });

    await recordObservations(db, [
      ...priorSeasonWeek("00-9000001", 1, { rushingYards: 200, carries: 20, receptions: 3, receivingYards: 30 }),
      ...priorSeasonWeek("00-9000001", 2, { rushingYards: 100, carries: 15, receptions: 2, receivingYards: 15 }),
      participationRow("00-9000001", 1, STAT_LINE_SOURCE, PARTICIPATION_METRICS.teamTargets, 20),
      participationRow("00-9000001", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.offensiveSnaps, 50),
      participationRow("00-9000001", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.teamOffensiveSnaps, 60),
      ...priorSeasonWeek("00-9000002", 1, { rushingYards: 50, carries: 10, receptions: 1, receivingYards: 5 }),
      participationRow("00-9000002", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.offensiveSnaps, 15),
      participationRow("00-9000002", 1, NFLVERSE_SOURCE.snapCounts, PARTICIPATION_METRICS.teamOffensiveSnaps, 60),
      ...priorSeasonWeek("00-9000003", 1, { receptions: 6, receivingYards: 90, targets: 9 }),
    ]);

    const all = await collectAllPlayerFacts(db);
    const expected = all.find((f) => f.identity.id === "p1")!;
    expect(expected.lastSeasonStory).not.toBeNull();
    expect(expected.usage).not.toBeNull();

    const one = await collectPlayerFacts(db, "p1");
    expect(one).toEqual(expected);
    expect(one!.factsHash).toBe(expected.factsHash);

    // And the peer, so the deep-equal check above wasn't merely comparing two nulls.
    const expectedPeer = all.find((f) => f.identity.id === "p2")!;
    const peer = await collectPlayerFacts(db, "p2");
    expect(peer).toEqual(expectedPeer);
  });

  it("matches collectAllPlayerFacts' own entry for a rookie with no prior-season color facts at all", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-9100001", name: "Rookie Runner", position: "RB", team: "SF", points: 200, rank: 1, adp: 20 });

    const all = await collectAllPlayerFacts(db);
    const expected = all.find((f) => f.identity.id === "p1")!;
    expect(expected.lastSeasonStory).toBeNull();
    expect(expected.usage).toBeNull();
    expect(expected.trend).toBeNull();

    const one = await collectPlayerFacts(db, "p1");
    expect(one).toEqual(expected);
  });
});
