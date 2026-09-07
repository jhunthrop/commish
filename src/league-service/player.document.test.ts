import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { collectBoardFacts } from "@/capsules/collect";
import { writeRefresh } from "@/capsules/peek-facts";
import { writePeekDocuments } from "@/capsules/peek-document-store";
import type { PeekDocumentRequest } from "@/capsules/peek-document-inputs";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { jobs, nflPlayers, playerCrosswalk, players, playerPeekDocuments, preseasonProjections, users } from "@/db/schema";
import { PEEK_DOCUMENT_JOB_NAME, runPeekDocumentStep } from "@/jobs/defs/peek-document-job";
import { createTestDb, truncateAll, TEST_DATABASE_URL } from "@/db/test-db";
import { PPR_SCORING } from "@/domain/scoring";
import { statMetricName } from "@/projections/lines";
import { DERIVED_STAT_LINE_SOURCE } from "@/projections/nflverse/derived-stat-lines";
import { PBP_PLAYER_METRICS, PBP_PLAYER_SOURCE } from "@/projections/nflverse/pbp-players";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { recordObservations, type PlayerWeekObservation } from "@/projections/store";
import { scoringHashOf } from "@/scoring/hash";
import { createLeague } from "./creation";
import { playerSeason } from "./player";

/**
 * WHAT ONE PEEK COSTS NOW, AND THAT IT STILL SAYS THE SAME THING (peek document design §3.2 and
 * §5, 2026-09-07).
 *
 * ONE STATEMENT IS AN EQUALITY, not a ceiling. The peek-facts round pinned a CEILING because the
 * remaining queries each answered a different question of a different table and a ceiling left room
 * for an honest change. This design's whole claim is that there is exactly one round trip, so the
 * test asserts exactly one: a second statement appearing is the failure, not a regression in degree.
 *
 * PARITY IS A RECORDED FIXTURE, not a comparison of the new code against itself. The JSON beside
 * this file was written by the PRE-CHANGE `playerSeason` (the request-time assembly this round
 * replaced) against this exact seed, with `PEEK_PARITY_RECORD=1`. Re-recording it is a deliberate
 * act that shows up as a diff in review, which is the only way a parity test can mean anything.
 *
 * `asOf` IS EXCLUDED FROM THE COMPARISON, and it is the only field that is: the pre-change body did
 * not have one, because there was no stored document to stamp. It is asserted separately below.
 */
const PARITY_FIXTURE = join(dirname(new URL(import.meta.url).pathname), "__fixtures__", "peek-body-parity.json");
const RECORDING = process.env.PEEK_PARITY_RECORD === "1";

const PRIOR_SEASON = PRODUCT_SEASON - 1;
const NOW = new Date("2026-09-07T12:00:00.000Z");
const clock = { now: () => NOW.toISOString() };
const PPR_HASH = scoringHashOf(PPR_SCORING);
let nextId = 0;

const SLOTS = [
  { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const] },
];

/** A drizzle handle over a client whose every statement bumps a counter — the same `postgres`
 *  `debug` hook `scripts/peek-timing.ts` uses against the dev database, so the harness and this test
 *  are counting the same thing. */
function countingDb(): { readonly db: Db; statements(): readonly string[]; reset(): void; close(): Promise<void> } {
  let seen: string[] = [];
  const client = postgres(TEST_DATABASE_URL, { max: 2, prepare: false, debug: (_connection, query) => { seen.push(query); } });
  const db = drizzle(client, { schema }) as unknown as Db;
  return {
    db,
    // THE DRIVER'S OWN CONNECTION BOOTSTRAP IS NOT A ROUND TRIP THIS PAGE PAYS. `postgres` reads the
    // array type OIDs out of `pg_catalog` once when a connection is first opened, before it can
    // decode anything, and never again for the life of that connection. A production request runs on
    // a warm pool and never sees it. Excluding it by name is narrower and more honest than warming
    // the pool first and hoping the count that follows is the interesting one.
    statements: () => seen.filter((query) => !query.includes("pg_catalog")),
    reset: () => { seen = []; },
    close: () => client.end(),
  };
}

const counting = countingDb();
afterAll(async () => { await counting.close(); });

function week(gsisId: string, season: number, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(season, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season, week: 1, playerId: gsisId, source: DERIVED_STAT_LINE_SOURCE, metric: statMetricName(field), value, asOf,
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
    season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: input.nflId, rank: input.rank, positionRank: input.rank,
    projectedPoints: input.points, valueOverReplacement: input.points, valueRank: input.rank, expectedGames: 17,
    floorPoints: input.points - 20, medianPoints: input.points, ceilingPoints: input.points + 20, tier: 0,
    asOf: new Date("2026-08-01T00:00:00Z"), momentKind: "live",
  });
}

/** The document body as JSON, with the one field this round adds removed. */
function comparable(body: unknown): unknown {
  const parsed = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
  delete parsed.asOf;
  return parsed;
}

describe("the peek is one statement over a stored document", () => {
  let db: Db;
  let leagueId: string;
  let request: PeekDocumentRequest;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(users).values([{ id: "u1", email: "u1@test.local", displayName: "Manager 1" }]);
    const created = await createLeague({ db, clock, newId: () => `id_${++nextId}` }, {
      name: "Document League", format: "snake", teamCount: 2, scoringPreset: "ppr", auctionBudget: null,
      rosterSlots: SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
      experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false, medianGame: false, isMock: false,
    });
    if (!created.ok) throw new Error(created.reason);
    leagueId = created.leagueId;
    await seedBack(db, { id: "rb1", nflId: "00-6000001", name: "Volume Back", rank: 1, points: 260 });
    await seedBack(db, { id: "rb2", nflId: "00-6000002", name: "Committee Back", rank: 2, points: 180 });
    await recordObservations(db, [
      ...week("00-6000001", PRIOR_SEASON, { rushingYards: 100, receptions: 5, receivingYards: 40 }),
      ...week("00-6000002", PRIOR_SEASON, { rushingYards: 30, receptions: 1, receivingYards: 10 }),
      participation("00-6000001", PBP_PLAYER_METRICS.carries, 20),
      participation("00-6000002", PBP_PLAYER_METRICS.carries, 6),
    ]);
    await writeRefresh(db, await collectBoardFacts(db, NOW));
    request = { season: PRODUCT_SEASON, scoringHash: PPR_HASH, rules: PPR_SCORING, playerIds: null, asOf: NOW };
    if (!RECORDING) await writePeekDocuments(db, request);
  });

  it("records the pre-change body when asked to, and otherwise matches it field by field", async () => {
    const body = await playerSeason(db, leagueId, "rb1", clock);
    expect(body).not.toBeNull();

    if (RECORDING) {
      mkdirSync(dirname(PARITY_FIXTURE), { recursive: true });
      writeFileSync(PARITY_FIXTURE, `${JSON.stringify(comparable(body), null, 2)}\n`);
      return;
    }
    expect(comparable(body)).toEqual(JSON.parse(readFileSync(PARITY_FIXTURE, "utf8")) as unknown);
  });

  it("opens a peek in exactly one statement", async () => {
    if (RECORDING) return;
    counting.reset();
    const body = await playerSeason(counting.db, leagueId, "rb1", clock);

    expect(body).not.toBeNull();
    expect(counting.statements()).toHaveLength(1);
    expect(counting.statements()[0]).toContain("player_peek_documents");
  });

  it("surfaces the document's own as_of", async () => {
    if (RECORDING) return;
    const body = await playerSeason(db, leagueId, "rb1", clock);
    expect(body!.asOf).toBe(NOW.toISOString());
  });

  it("names the holder from the live roster, still in one statement", async () => {
    if (RECORDING) return;
    const [team] = await db.select({ id: schema.teams.id }).from(schema.teams);
    await db.insert(schema.rosterSlots).values({ teamId: team!.id, playerId: "rb1", slot: "RB", slotIndex: 0 });

    counting.reset();
    const body = await playerSeason(counting.db, leagueId, "rb1", clock);
    expect(body!.ownedBy).toBe("Team One");
    expect(counting.statements()).toHaveLength(1);
  });

  it("reads the latest document at or before now and never a later one", async () => {
    if (RECORDING) return;
    const later = new Date("2026-09-08T12:00:00.000Z");
    await writePeekDocuments(db, { ...request, asOf: later });

    const body = await playerSeason(db, leagueId, "rb1", clock);
    expect(body!.asOf).toBe(NOW.toISOString());
    expect((await playerSeason(db, leagueId, "rb1", { now: () => later.toISOString() }))!.asOf).toBe(later.toISOString());
  });

  it("offers the prior season the store actually holds", async () => {
    if (RECORDING) return;
    const body = await playerSeason(db, leagueId, "rb1", clock);
    expect(body!.availableSeasons).toEqual([PRIOR_SEASON]);
    expect(body!.season).toBe(PRIOR_SEASON);
  });

  it("carries the precomputed dossier", async () => {
    if (RECORDING) return;
    const body = await playerSeason(db, leagueId, "rb1", clock);
    expect(body!.dossier).not.toBeNull();
    expect(body!.dossier!.lastSeasonStory!.touchesRank).toEqual({ value: 25, positionRank: 1, qualifierCount: 2, namedNeighbor: null });
  });

  describe("the miss path", () => {
    beforeEach(async () => {
      if (!RECORDING) await db.delete(playerPeekDocuments);
    });

    it("still renders the player, and asks for the whole hash to be built", async () => {
      if (RECORDING) return;
      const body = await playerSeason(db, leagueId, "rb1", clock);
      expect(body!.player.name).toBe("Volume Back");

      // The facts writer already enqueued its own rebuild in the seed above, so the miss job is
      // found by its key rather than by being the only one.
      const [job] = await db.select().from(jobs).where(eq(jobs.idempotencyKey, `peek-document:${PPR_HASH}:miss:2026-09-07`));
      expect(job!.payload).toMatchObject({ scoringHash: PPR_HASH, playerIds: null, reason: "miss:2026-09-07" });
    });

    it("coalesces every miss inside one day into a single build", async () => {
      if (RECORDING) return;
      await playerSeason(db, leagueId, "rb1", clock);
      await playerSeason(db, leagueId, "rb2", clock);

      const misses = (await db.select().from(jobs).where(eq(jobs.name, PEEK_DOCUMENT_JOB_NAME)))
        .filter((job) => String((job.payload as { readonly reason: string }).reason).startsWith("miss:"));
      expect(misses).toHaveLength(1);
    });

    /**
     * `enqueueJob` refuses a key it has already seen whatever became of that job, dead-lettered
     * included. Without a generation stamp a novel hash whose FIRST build failed its attempts could
     * never be asked for again, and every league on that hash would pay the miss path forever.
     */
    it("asks again on a later day, so a build that never landed gets another chance", async () => {
      if (RECORDING) return;
      await playerSeason(db, leagueId, "rb1", clock);
      await playerSeason(db, leagueId, "rb1", { now: () => "2026-09-08T09:00:00.000Z" });

      const misses = (await db.select().from(jobs).where(eq(jobs.name, PEEK_DOCUMENT_JOB_NAME)))
        .filter((job) => String((job.payload as { readonly reason: string }).reason).startsWith("miss:"));
      expect(misses.map((job) => (job.payload as { readonly reason: string }).reason).sort()).toEqual(["miss:2026-09-07", "miss:2026-09-08"]);
    });

    it("says exactly what a stored document would have said", async () => {
      if (RECORDING) return;
      const live = await playerSeason(db, leagueId, "rb1", clock);
      await writePeekDocuments(db, request);
      const stored = await playerSeason(db, leagueId, "rb1", clock);

      expect(comparable(live)).toEqual(comparable(stored));
    });

    it("is one statement again once the build has run", async () => {
      if (RECORDING) return;
      await playerSeason(db, leagueId, "rb1", clock);
      await runPeekDocumentStep(db, clock, { scoringHash: PPR_HASH, playerIds: null, reason: "miss" });

      counting.reset();
      const body = await playerSeason(counting.db, leagueId, "rb1", clock);
      expect(body).not.toBeNull();
      expect(counting.statements()).toHaveLength(1);
    });

    it("returns nothing at all for a player who does not exist", async () => {
      if (RECORDING) return;
      expect(await playerSeason(db, leagueId, "nobody", clock)).toBeNull();
    });

    it("returns nothing at all for a league that does not exist", async () => {
      if (RECORDING) return;
      expect(await playerSeason(db, "no_such_league", "rb1", clock)).toBeNull();
    });

    /**
     * ADDITION B (review, 2026-09-07) — the two miss branches are not the same miss. A hash with no
     * documents at all is a novel scoring combination and still builds live; a BUILT hash asked
     * about an off-board player has nothing to build, and the founder screenshotted the five to
     * fifteen seconds of blank sheet that discovery used to cost.
     */
    it("answers an off-board player from a built hash without the synchronous build", async () => {
      if (RECORDING) return;
      // The hash HAS documents (the seeded build above), and this player is on no board.
      await writePeekDocuments(db, request);
      await db.insert(players).values({ id: "off_board", name: "Practice Squad", position: "WR", nflTeam: "SF", adp: null });

      counting.reset();
      const body = await playerSeason(counting.db, leagueId, "off_board", clock);

      expect(body!.player.name).toBe("Practice Squad");
      expect(body!.dossier).toBeNull();
      expect(body!.capsule).toBeNull();
      expect(body!.availableSeasons).toEqual([]);
      expect(body!.reasons).toEqual([]);
      // The whole point: no board join, no facts read, no capsule read, no stat lines. A handful of
      // small statements, nowhere near the assembly a build runs.
      expect(counting.statements().length).toBeLessThan(12);
      // And the hash is still asked to be rebuilt, so he joins the documents on the next build.
      const [job] = await db.select().from(jobs).where(eq(jobs.idempotencyKey, `peek-document:${PPR_HASH}:miss:2026-09-07`));
      expect(job).toBeDefined();
    });

    it("still builds synchronously for a board player the built hash has no row for", async () => {
      if (RECORDING) return;
      await writePeekDocuments(db, request);
      // rb2 IS on the board (the seed gives him a projection row); his document is deleted, so the
      // hash has documents but not his.
      await db.delete(playerPeekDocuments).where(eq(playerPeekDocuments.playerId, "rb2"));

      const body = await playerSeason(db, leagueId, "rb2", clock);

      expect(body).not.toBeNull();
      // The build ran: his board rank is on the body, where the off-board branch would have
      // returned a null rank and nothing else.
      expect(body!.positionRank).not.toBeNull();
    });

    it("renders absence for a real player nothing has been computed for", async () => {
      if (RECORDING) return;
      await db.insert(players).values({ id: "signed_in_october", name: "Late Signing", position: "WR", nflTeam: "SF", adp: null });

      const body = await playerSeason(db, leagueId, "signed_in_october", clock);
      expect(body!.dossier).toBeNull();
      expect(body!.capsule).toBeNull();
      expect(body!.availableSeasons).toEqual([]);
      expect(body!.isRookie).toBe(false);
      expect(body!.weeks).toEqual([]);
      expect(body!.totals).toBeNull();
    });
  });
});
