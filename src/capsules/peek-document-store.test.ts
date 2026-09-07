import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, playerPeekDocuments, preseasonProjections } from "@/db/schema";
import { PPR_SCORING, STANDARD_SCORING } from "@/domain/scoring";
import { statMetricName } from "@/projections/lines";
import { DERIVED_STAT_LINE_SOURCE } from "@/projections/nflverse/derived-stat-lines";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { recordObservations, type PlayerWeekObservation } from "@/projections/store";
import { scoringHashOf } from "@/scoring/hash";
import { collectBoardFacts } from "./collect";
import { writeRefresh } from "./peek-facts";
import { writePeekDocuments } from "./peek-document-store";
import type { PeekDocumentRequest } from "./peek-document-inputs";
import { upsertCapsule } from "./store";

const PRIOR_SEASON = PRODUCT_SEASON - 1;
const NOW = new Date("2026-09-07T12:00:00.000Z");
const PPR_HASH = scoringHashOf(PPR_SCORING);
const STANDARD_HASH = scoringHashOf(STANDARD_SCORING);

const db: Db = createTestDb();

function week(gsisId: string, season: number, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(season, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season, week: 1, playerId: gsisId, source: DERIVED_STAT_LINE_SOURCE, metric: statMetricName(field), value, asOf,
  }));
}

async function seedBack(input: { readonly id: string; readonly nflId: string; readonly name: string; readonly rank: number; readonly points: number }): Promise<void> {
  await db.insert(nflPlayers).values({ id: input.nflId, name: input.name, position: "RB" });
  await db.insert(players).values({ id: input.id, name: input.name, position: "RB", nflTeam: "SF", adp: 10 + input.rank });
  await db.insert(playerCrosswalk).values({ playerId: input.id, nflPlayerId: input.nflId, method: "espn_id", resolvedAt: NOW });
  await db.insert(preseasonProjections).values({
    season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: input.nflId, rank: input.rank, positionRank: input.rank,
    projectedPoints: input.points, valueOverReplacement: input.points, valueRank: input.rank, expectedGames: 17,
    floorPoints: input.points - 20, medianPoints: input.points, ceilingPoints: input.points + 20, tier: 0,
    asOf: new Date("2026-08-01T00:00:00Z"), momentKind: "live",
  });
}

const request: PeekDocumentRequest = { season: PRODUCT_SEASON, scoringHash: PPR_HASH, rules: PPR_SCORING, playerIds: null, asOf: NOW };

beforeEach(async () => {
  await truncateAll(db);
  await seedBack({ id: "rb1", nflId: "00-6000001", name: "Volume Back", rank: 1, points: 260 });
  await seedBack({ id: "rb2", nflId: "00-6000002", name: "Committee Back", rank: 2, points: 180 });
  await recordObservations(db, [
    ...week("00-6000001", PRIOR_SEASON, { rushingYards: 100, receptions: 5, receivingYards: 40 }),
    ...week("00-6000002", PRIOR_SEASON, { rushingYards: 30, receptions: 1, receivingYards: 10 }),
  ]);
  await writeRefresh(db, await collectBoardFacts(db, NOW));
});

afterAll(async () => {
  await truncateAll(db);
});

describe("writePeekDocuments", () => {
  it("writes one document per player for the hash", async () => {
    const written = await writePeekDocuments(db, request);
    expect(written.players).toBe(2);
    expect(written.changed).toBe(2);
  });

  it("writes zero changed rows on a second run at the same moment", async () => {
    await writePeekDocuments(db, request);
    expect((await writePeekDocuments(db, request)).changed).toBe(0);
  });

  it("counts a changed row when one input moves", async () => {
    await writePeekDocuments(db, request);
    await upsertCapsule(db, "rb1", "facts_hash_2", {
      source: "template",
      model: null,
      compact: { text: "A newly written capsule.", usage: null, source: "template", fallbackReason: null },
      full: { text: "A newly written capsule, at length.", usage: null, source: "template", fallbackReason: null },
      narrative: { slots: {}, usage: null, model: null, rejected: [], failure: null },
    });

    expect((await writePeekDocuments(db, request)).changed).toBe(1);
  });

  it("keeps two scoring hashes apart", async () => {
    await writePeekDocuments(db, request);
    await writePeekDocuments(db, { ...request, scoringHash: STANDARD_HASH, rules: STANDARD_SCORING });

    const rows = await db.select().from(playerPeekDocuments);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.scoringHash))).toEqual(new Set([PPR_HASH, STANDARD_HASH]));
  });

  it("scores the same week differently under each hash's own rules", async () => {
    await writePeekDocuments(db, request);
    await writePeekDocuments(db, { ...request, scoringHash: STANDARD_HASH, rules: STANDARD_SCORING });

    const [ppr] = await db.select().from(playerPeekDocuments).where(eq(playerPeekDocuments.scoringHash, PPR_HASH));
    const [standard] = await db.select().from(playerPeekDocuments).where(eq(playerPeekDocuments.scoringHash, STANDARD_HASH));
    const pointsOf = (row: typeof ppr): number => row!.document.seasons[0]!.weeks.find((one) => one.points !== null)!.points!;
    // Five receptions are worth five more points in a full point per reception league.
    expect(pointsOf(ppr) - pointsOf(standard)).toBeCloseTo(5, 5);
  });

  it("builds only the players it was asked for", async () => {
    const written = await writePeekDocuments(db, { ...request, playerIds: ["rb1"] });
    expect(written.players).toBe(1);
    const rows = await db.select({ playerId: playerPeekDocuments.playerId }).from(playerPeekDocuments);
    expect(rows.map((row) => row.playerId)).toEqual(["rb1"]);
  });

  it("stamps every row with its own as_of, its basis and its source", async () => {
    await writePeekDocuments(db, request);
    const [row] = await db.select().from(playerPeekDocuments).where(eq(playerPeekDocuments.playerId, "rb1"));

    expect(row!.asOf.toISOString()).toBe(NOW.toISOString());
    expect(row!.source).toBe("peek_document_v1");
    expect(row!.basis.scoringHash).toBe(PPR_HASH);
    expect(row!.basis.factsAsOf).toBe(NOW.toISOString());
    expect(row!.document.asOf).toBe(NOW.toISOString());
  });

  it("carries the prior season the store actually holds, and no season it does not", async () => {
    await writePeekDocuments(db, request);
    const [row] = await db.select().from(playerPeekDocuments).where(eq(playerPeekDocuments.playerId, "rb1"));

    expect(row!.document.availableSeasons).toEqual([PRIOR_SEASON]);
    expect(row!.document.seasons.map((season) => season.season)).toEqual([PRIOR_SEASON]);
  });

  it("keeps three generations per player and drops the rest", async () => {
    for (let day = 0; day < 5; day += 1) {
      await writePeekDocuments(db, { ...request, asOf: new Date(NOW.getTime() + day * 86_400_000) });
    }

    const rows = await db.select({ asOf: playerPeekDocuments.asOf }).from(playerPeekDocuments).where(eq(playerPeekDocuments.playerId, "rb1"));
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.asOf.toISOString()).sort()).toEqual([
      new Date(NOW.getTime() + 2 * 86_400_000).toISOString(),
      new Date(NOW.getTime() + 3 * 86_400_000).toISOString(),
      new Date(NOW.getTime() + 4 * 86_400_000).toISOString(),
    ]);
  });

  it("reports what it pruned, and prunes nothing inside the window", async () => {
    expect((await writePeekDocuments(db, request)).pruned).toBe(0);
    expect((await writePeekDocuments(db, { ...request, asOf: new Date(NOW.getTime() + 86_400_000) })).pruned).toBe(0);
    expect((await writePeekDocuments(db, { ...request, asOf: new Date(NOW.getTime() + 2 * 86_400_000) })).pruned).toBe(0);
    // The fourth generation is the first one that pushes a generation out, for both players.
    expect((await writePeekDocuments(db, { ...request, asOf: new Date(NOW.getTime() + 3 * 86_400_000) })).pruned).toBe(2);
  });

  it("never prunes another hash's generations", async () => {
    for (let day = 0; day < 4; day += 1) {
      await writePeekDocuments(db, { ...request, asOf: new Date(NOW.getTime() + day * 86_400_000) });
    }
    await writePeekDocuments(db, { ...request, scoringHash: STANDARD_HASH, rules: STANDARD_SCORING });

    const standard = await db.select().from(playerPeekDocuments).where(eq(playerPeekDocuments.scoringHash, STANDARD_HASH));
    expect(standard).toHaveLength(2);
  });

  it("carries the dossier the precomputed facts row holds", async () => {
    await writePeekDocuments(db, request);
    const [row] = await db.select().from(playerPeekDocuments).where(eq(playerPeekDocuments.playerId, "rb1"));

    expect(row!.document.dossier).not.toBeNull();
  });
});
