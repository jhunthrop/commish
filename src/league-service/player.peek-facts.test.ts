import { beforeEach, describe, expect, it } from "vitest";
import { collectBoardFacts } from "@/capsules/collect";
import { writeRefresh } from "@/capsules/peek-facts";
import type { Db } from "@/db/client";
import { nflPlayers, playerCrosswalk, players, preseasonProjections, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { statMetricName } from "@/projections/lines";
import { DERIVED_STAT_LINE_SOURCE } from "@/projections/nflverse/derived-stat-lines";
import { PBP_PLAYER_METRICS, PBP_PLAYER_SOURCE } from "@/projections/nflverse/pbp-players";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { recordObservations, type PlayerWeekObservation } from "@/projections/store";
import { createLeague } from "./creation";
import { dossierFactsFor } from "./dossier-facts";
import { playerSeason } from "./player";

/**
 * WHAT THE PRECOMPUTED FACTS ROW ACTUALLY PUTS ON THE CARD (peek-facts design §3.5, 2026-09-07).
 *
 * THE QUERY COUNT MOVED OUT OF THIS FILE (peek document round, 2026-09-07). This file used to pin a
 * ceiling of twenty-two statements for one peek, and a ceiling was the honest shape for a number
 * made of a dozen different questions of a dozen different tables. The peek is now ONE statement
 * over a stored document, which is an equality rather than a ceiling, and it is asserted in
 * `player.document.test.ts` beside the writer that produces the document. What this file keeps is
 * what it was really about: that the stored dossier, the touches rank and the prior-season list
 * reach the screen unchanged.
 *
 * IT EXERCISES THE MISS PATH ON PURPOSE. No peek documents are written by this seed, so every read
 * below goes through `playerSeason`'s own miss path, which builds one player's document through the
 * writer's own builder. A body that came out different depending on which of the two paths served it
 * would be the failure this design cannot survive, and these assertions are where it would show.
 */
const PRIOR_SEASON = PRODUCT_SEASON - 1;
const NOW = new Date("2026-09-07T12:00:00.000Z");
const clock = { now: () => NOW.toISOString() };
let nextId = 0;

const SLOTS = [
  { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const] },
];

function week(gsisId: string, season: number, source: string, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(season, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season, week: 1, playerId: gsisId, source, metric: statMetricName(field), value, asOf,
  }));
}

function participation(gsisId: string, metric: string, value: number): PlayerWeekObservation {
  return { season: PRIOR_SEASON, week: 1, playerId: gsisId, source: PBP_PLAYER_SOURCE, metric, value, asOf: new Date(Date.UTC(PRIOR_SEASON, 10, 1)) };
}

async function seedBack(db: Db, input: { readonly id: string; readonly nflId: string; readonly name: string; readonly rank: number; readonly points: number }): Promise<void> {
  await db.insert(nflPlayers).values({ id: input.nflId, name: input.name, position: "RB" });
  await db.insert(players).values({ id: input.id, name: input.name, position: "RB", nflTeam: "SF", adp: 10 + input.rank });
  await db.insert(playerCrosswalk).values({ playerId: input.id, nflPlayerId: input.nflId, method: "espn_id", resolvedAt: NOW });
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

describe("what the precomputed facts row puts on the card", () => {
  let db: Db;
  let leagueId: string;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(users).values([{ id: "u1", email: "u1@test.local", displayName: "Manager 1" }]);
    const created = await createLeague({ db, clock, newId: () => `id_${++nextId}` }, {
      name: "Timing League", format: "snake", teamCount: 2, scoringPreset: "ppr", auctionBudget: null,
      rosterSlots: SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
      experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false, medianGame: false, isMock: false,
    });
    if (!created.ok) throw new Error(created.reason);
    leagueId = created.leagueId;
    await seedBack(db, { id: "rb1", nflId: "00-6000001", name: "Volume Back", rank: 1, points: 260 });
    await seedBack(db, { id: "rb2", nflId: "00-6000002", name: "Committee Back", rank: 2, points: 180 });
    await recordObservations(db, [
      ...week("00-6000001", PRIOR_SEASON, DERIVED_STAT_LINE_SOURCE, { rushingYards: 100, receptions: 5, receivingYards: 40 }),
      ...week("00-6000002", PRIOR_SEASON, DERIVED_STAT_LINE_SOURCE, { rushingYards: 30, receptions: 1, receivingYards: 10 }),
      participation("00-6000001", PBP_PLAYER_METRICS.carries, 20),
      participation("00-6000002", PBP_PLAYER_METRICS.carries, 6),
    ]);
    await writeRefresh(db, await collectBoardFacts(db, NOW));
  });

  it("puts the precomputed dossier on the card", async () => {
    const body = await playerSeason(db, leagueId, "rb1", clock);

    expect(body).not.toBeNull();
    expect(body!.dossier).not.toBeNull();
  });

  it("renders the same dossier the live computation produces for the same player", async () => {
    const live = await dossierFactsFor(db, "rb1", NOW);
    const body = await playerSeason(db, leagueId, "rb1", clock);

    expect(JSON.parse(JSON.stringify(body!.dossier))).toEqual(JSON.parse(JSON.stringify(live)));
  });

  it("carries the touches rank the peek used to show empty", async () => {
    const body = await playerSeason(db, leagueId, "rb1", clock);
    expect(body!.dossier!.lastSeasonStory!.touchesRank).toEqual({ value: 25, positionRank: 1, qualifierCount: 2, namedNeighbor: null });
  });

  it("offers the prior season the precomputed row says the store holds", async () => {
    const body = await playerSeason(db, leagueId, "rb1", clock);
    expect(body!.availableSeasons).toEqual([PRIOR_SEASON]);
    expect(body!.season).toBe(PRIOR_SEASON);
  });
});
