import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { collectBoardFacts } from "@/capsules/collect";
import { writeRefresh } from "@/capsules/peek-facts";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { nflPlayers, playerCrosswalk, players, preseasonProjections, users } from "@/db/schema";
import { createTestDb, truncateAll, TEST_DATABASE_URL } from "@/db/test-db";
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
 * WHAT THE PEEK COSTS, ASSERTED (peek-facts design §3.5, 2026-09-07).
 *
 * The production measurement this round started from was 73 queries and 13.8 s for a receiver, of
 * which `collectPlayerFacts` alone was 43 queries. A number that big cannot be defended by reading
 * the code, so it is pinned here with a real counting client — the same `postgres` `debug` hook
 * `scripts/peek-timing.ts` uses against the dev database, so the harness and the test are counting
 * the same thing.
 *
 * THE CEILING IS A CEILING, not an equality. A test that pinned an exact count would fail on any
 * honest change (a new field, a narrowed read) without anything having got worse, and would train
 * a future round to update the number rather than ask why it moved.
 *
 * WHAT THE REMAINING QUERIES ARE, and why the design's "at most eight" was not reached. Twelve of
 * them are one wave with no dependency between any two: the player row, the league row, the
 * fixtures, the played weeks, the scoring settings, the product player universe, the crosswalk, the
 * precomputed row, the roster holder, the injuries snapshot, the news snapshot and the capsule. The
 * rest are the prior season's own chart (the position's peers plus the point-in-time stat lines,
 * which a gap season reads twice by design) and the four draft-outlook reads (the loud
 * single-generation guard, expert consensus, our own board row, the board's stored reasons). Each
 * one answers a different question of a different table for a different part of the screen; getting
 * to eight would mean either dropping something the screen shows or inventing a joined reader whose
 * only purpose is to make this number smaller. What the round actually removed is the forty-three
 * queries `collectPlayerFacts` was running at request time, the duplicate board-reasons and
 * injuries reads, the two whole-universe position reads and the three serial prior-season checks.
 */
const QUERY_CEILING = 22;

const PRIOR_SEASON = PRODUCT_SEASON - 1;
const NOW = new Date("2026-09-07T12:00:00.000Z");
const clock = { now: () => NOW.toISOString() };
let nextId = 0;

const SLOTS = [
  { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const] },
];

/** A drizzle handle over a client whose every statement bumps a counter. */
function countingDb(): { readonly db: Db; count(): number; reset(): void; close(): Promise<void> } {
  let queries = 0;
  const client = postgres(TEST_DATABASE_URL, { max: 2, prepare: false, debug: () => { queries += 1; } });
  const db = drizzle(client, { schema }) as unknown as Db;
  return { db, count: () => queries, reset: () => { queries = 0; }, close: () => client.end() };
}

const counting = countingDb();
afterAll(async () => { await counting.close(); });

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

describe("what a peek costs once the facts are precomputed", () => {
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

  it("stays under the query ceiling for a skill player", async () => {
    counting.reset();
    const body = await playerSeason(counting.db, leagueId, "rb1", clock);

    expect(body).not.toBeNull();
    expect(body!.dossier).not.toBeNull();
    expect(counting.count()).toBeLessThanOrEqual(QUERY_CEILING);
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
