import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { nflPlayers, playerCrosswalk, playerPeekFacts, players, preseasonProjections } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { statMetricName, STAT_LINE_SOURCE } from "@/projections/lines";
import { DERIVED_STAT_LINE_SOURCE } from "@/projections/nflverse/derived-stat-lines";
import { PBP_PLAYER_METRICS, PBP_PLAYER_SOURCE } from "@/projections/nflverse/pbp-players";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { recordObservations, type PlayerWeekObservation } from "@/projections/store";
import { collectBoardFacts } from "./collect";
import { dossierFactsFor } from "@/league-service/dossier-facts";
import { peekFactsRowsFor, readPeekFacts, writePeekFacts, writeRefresh } from "./peek-facts";
import { PEEK_FACTS_SOURCE } from "./peek-facts-row";

const PRIOR_SEASON = PRODUCT_SEASON - 1;
const AS_OF = new Date("2026-09-07T12:00:00.000Z");

async function seedPlayer(db: Db, input: { readonly id: string; readonly nflId: string; readonly name: string; readonly rank: number; readonly points: number }): Promise<void> {
  await db.insert(nflPlayers).values({ id: input.nflId, name: input.name, position: "RB" });
  await db.insert(players).values({ id: input.id, name: input.name, position: "RB", nflTeam: "SF", adp: 10 + input.rank });
  await db.insert(playerCrosswalk).values({ playerId: input.id, nflPlayerId: input.nflId, method: "espn_id", resolvedAt: new Date() });
  await db.insert(preseasonProjections).values({
    season: PRODUCT_SEASON,
    source: BOARD_SOURCE,
    playerId: input.nflId,
    rank: input.rank,
    positionRank: input.rank,
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

function week(gsisId: string, season: number, weekNumber: number, source: string, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(season, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season, week: weekNumber, playerId: gsisId, source, metric: statMetricName(field), value, asOf,
  }));
}

function participation(gsisId: string, season: number, metric: string, value: number): PlayerWeekObservation {
  return { season, week: 1, playerId: gsisId, source: PBP_PLAYER_SOURCE, metric, value, asOf: new Date(Date.UTC(season, 10, 1)) };
}

/** Two backs with a real prior season, in the shape production actually holds for a gap season:
 *  derived stat lines plus play-by-play participation, no published weekly feed anywhere. */
async function seedTwoBacks(db: Db): Promise<void> {
  await seedPlayer(db, { id: "p1", nflId: "00-5000001", name: "Volume Back", rank: 1, points: 260 });
  await seedPlayer(db, { id: "p2", nflId: "00-5000002", name: "Committee Back", rank: 2, points: 180 });
  await recordObservations(db, [
    ...week("00-5000001", PRIOR_SEASON, 1, DERIVED_STAT_LINE_SOURCE, { rushingYards: 100, receptions: 5, receivingYards: 40 }),
    ...week("00-5000002", PRIOR_SEASON, 1, DERIVED_STAT_LINE_SOURCE, { rushingYards: 30, receptions: 1, receivingYards: 10 }),
    participation("00-5000001", PRIOR_SEASON, PBP_PLAYER_METRICS.carries, 20),
    participation("00-5000001", PRIOR_SEASON, PBP_PLAYER_METRICS.targets, 6),
    participation("00-5000002", PRIOR_SEASON, PBP_PLAYER_METRICS.carries, 6),
    participation("00-5000002", PRIOR_SEASON, PBP_PLAYER_METRICS.targets, 2),
  ]);
}

describe("the peek-facts writer", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("writes one row per board player", async () => {
    await seedTwoBacks(db);

    const refresh = await writeRefresh(db, await collectBoardFacts(db, AS_OF));

    expect(refresh.players).toBe(2);
    expect(refresh.changed).toBe(2);
    const rows = await db.select().from(playerPeekFacts);
    expect(rows.map((row) => row.playerId).sort()).toEqual(["p1", "p2"]);
    expect(rows.every((row) => row.source === PEEK_FACTS_SOURCE)).toBe(true);
    expect(rows.every((row) => row.season === PRODUCT_SEASON)).toBe(true);
  });

  it("changes zero rows on a second pass at the same moment", async () => {
    await seedTwoBacks(db);

    await writeRefresh(db, await collectBoardFacts(db, AS_OF));
    const second = await writeRefresh(db, await collectBoardFacts(db, AS_OF));

    expect(second.players).toBe(2);
    expect(second.changed).toBe(0);
    expect(await db.select().from(playerPeekFacts)).toHaveLength(2);
  });

  it("stores the touches rank the gap-season fix produces, with the population it was taken over", async () => {
    await seedTwoBacks(db);

    await writeRefresh(db, await collectBoardFacts(db, AS_OF));

    const volume = await readPeekFacts(db, "p1", PRODUCT_SEASON, AS_OF);
    expect(volume?.touchesRank).toBe(1);
    expect(volume?.touchesQualifierCount).toBe(2);
    expect(volume?.basis.refusals).toEqual([]);
    expect(volume?.basis.peerPopulation).toBe(2);
    expect(volume?.basis.priorSeason).toBe(PRIOR_SEASON);
    // A gap season names the play-by-play pair, never the published weekly feed it does not have.
    expect(volume?.basis.sourceKeys).toContain(DERIVED_STAT_LINE_SOURCE);
    expect(volume?.basis.sourceKeys).toContain(PBP_PLAYER_SOURCE);
    expect(volume?.basis.sourceKeys).not.toContain(STAT_LINE_SOURCE);
  });

  it("keeps the promoted scalars and the dossier blob saying the same thing", async () => {
    await seedTwoBacks(db);

    await writeRefresh(db, await collectBoardFacts(db, AS_OF));

    for (const playerId of ["p1", "p2"]) {
      const row = await readPeekFacts(db, playerId, PRODUCT_SEASON, AS_OF);
      const inBlob = row?.dossier.lastSeasonStory?.touchesRank ?? null;
      expect(row?.touchesRank).toBe(inBlob === null ? null : inBlob.positionRank);
      expect(row?.touchesQualifierCount).toBe(inBlob === null ? null : inBlob.qualifierCount);
    }
  });

  it("refuses a touches rank it has no evidence for, and says why on the row", async () => {
    // A published prior season for one back only, so the other has a story but no touches at all.
    await seedPlayer(db, { id: "p1", nflId: "00-5100001", name: "Counted Back", rank: 1, points: 260 });
    await seedPlayer(db, { id: "p2", nflId: "00-5100002", name: "Uncounted Back", rank: 2, points: 180 });
    await recordObservations(db, [
      ...week("00-5100001", PRIOR_SEASON, 1, DERIVED_STAT_LINE_SOURCE, { rushingYards: 100, receptions: 5 }),
      ...week("00-5100002", PRIOR_SEASON, 1, DERIVED_STAT_LINE_SOURCE, { rushingYards: 30, receptions: 1 }),
      participation("00-5100001", PRIOR_SEASON, PBP_PLAYER_METRICS.carries, 20),
    ]);

    await writeRefresh(db, await collectBoardFacts(db, AS_OF));

    const uncounted = await readPeekFacts(db, "p2", PRODUCT_SEASON, AS_OF);
    expect(uncounted?.touchesRank).toBeNull();
    expect(uncounted?.touchesQualifierCount).toBeNull();
    expect(uncounted?.basis.refusals).toEqual([`The participation feed placed no ${PRIOR_SEASON} touches for him.`]);
    expect(uncounted?.dossier.lastSeasonStory?.touchesRank ?? null).toBeNull();
  });

  it("refuses every touches rank when the prior-season read produced no player at all", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-5200001", name: "Rookie Back", rank: 1, points: 260 });

    await writeRefresh(db, await collectBoardFacts(db, AS_OF));

    const row = await readPeekFacts(db, "p1", PRODUCT_SEASON, AS_OF);
    expect(row?.touchesRank).toBeNull();
    expect(row?.basis.priorSeasonPlayerCount).toBe(0);
    expect(row?.basis.refusals).toEqual([`No ${PRIOR_SEASON} stat line was read for any player, so no touches rank was computed.`]);
    expect(row?.lastSeasonLine).toBeNull();
  });

  it("states last season league-agnostically, off the same story the rank came from", async () => {
    await seedTwoBacks(db);

    await writeRefresh(db, await collectBoardFacts(db, AS_OF));

    const volume = await readPeekFacts(db, "p1", PRODUCT_SEASON, AS_OF);
    // 100 rushing yards, 5 receptions, 40 receiving yards under PPR: 10 + 5 + 4 = 19.
    expect(volume?.lastSeasonLine).toEqual({ season: PRIOR_SEASON, points: 19, games: 1, pointsPerGame: 19 });
  });

  it("records which prior seasons the store actually holds a week of, newest first", async () => {
    await seedPlayer(db, { id: "p1", nflId: "00-5300001", name: "Veteran Back", rank: 1, points: 260 });
    await recordObservations(db, [
      ...week("00-5300001", PRIOR_SEASON, 1, DERIVED_STAT_LINE_SOURCE, { rushingYards: 100 }),
      ...week("00-5300001", PRODUCT_SEASON - 3, 1, STAT_LINE_SOURCE, { rushingYards: 80 }),
    ]);

    await writeRefresh(db, await collectBoardFacts(db, AS_OF));

    const row = await readPeekFacts(db, "p1", PRODUCT_SEASON, AS_OF);
    expect(row?.priorSeasonsHeld).toEqual([PRIOR_SEASON, PRODUCT_SEASON - 3]);
  });
});

describe("readPeekFacts", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("is null for a player no pass has reached", async () => {
    await seedTwoBacks(db);
    expect(await readPeekFacts(db, "p1", PRODUCT_SEASON, AS_OF)).toBeNull();
  });

  it("never reads a row stamped after the moment asked about", async () => {
    await seedTwoBacks(db);
    await writeRefresh(db, await collectBoardFacts(db, AS_OF));

    expect(await readPeekFacts(db, "p1", PRODUCT_SEASON, new Date("2026-09-06T00:00:00.000Z"))).toBeNull();
    expect(await readPeekFacts(db, "p1", PRODUCT_SEASON, AS_OF)).not.toBeNull();
  });

  it("hands back the newest row at or before the moment asked about", async () => {
    await seedTwoBacks(db);
    const earlier = new Date("2026-09-05T12:00:00.000Z");
    await writeRefresh(db, await collectBoardFacts(db, earlier));
    await writeRefresh(db, await collectBoardFacts(db, AS_OF));

    expect((await readPeekFacts(db, "p1", PRODUCT_SEASON, AS_OF))?.asOf).toEqual(AS_OF);
    expect((await readPeekFacts(db, "p1", PRODUCT_SEASON, earlier))?.asOf).toEqual(earlier);
  });
});

describe("the stored dossier and the live computation", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("agree field for field, which is what lets the peek stop computing at request time", async () => {
    await seedTwoBacks(db);
    const live = await dossierFactsFor(db, "p1", AS_OF);

    const rows = await peekFactsRowsFor(db, await collectBoardFacts(db, AS_OF));
    await writePeekFacts(db, rows);
    const stored = await readPeekFacts(db, "p1", PRODUCT_SEASON, AS_OF);

    // Through a real JSON round trip, which is what the database column actually stores.
    expect(JSON.parse(JSON.stringify(stored?.dossier))).toEqual(JSON.parse(JSON.stringify(live)));
  });
});
