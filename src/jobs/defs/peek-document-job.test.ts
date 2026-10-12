import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { collectBoardFacts } from "@research-ts/capsules/collect";
import { writeRefresh } from "@/league-service/peek/peek-facts";
import type { Db } from "@research-ts/db/client";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@research-ts/db/schema";
import { jobs, leagues, playerPeekDocuments, rosterSlots, teams, users } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { HALF_PPR_SCORING, PPR_SCORING, STANDARD_SCORING } from "@research-ts/domain/scoring";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { createLeague } from "@/league-service/creation";
import { writeLeagueScoring } from "@/league-service/settings";
import { statMetricName } from "@research-ts/projections/lines";
import { DERIVED_STAT_LINE_SOURCE } from "@research-ts/projections/nflverse/derived-stat-lines";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { recordObservations, type PlayerWeekObservation } from "@research-ts/projections/store";
import { scoringHashOf } from "@research-ts/scoring/hash";
import { runCapsuleSweepStep } from "./capsule-sweep-job";
import {
  enqueuePeekDocumentRebuildsQuietly,
  parsePeekDocumentJobPayload,
  PEEK_DOCUMENT_JOB_NAME,
  runPeekDocumentStep,
} from "./peek-document-job";

/**
 * EVERY ROW OF THE DESIGN'S OWN EVENT TABLE (peek document design §3.4, 2026-09-07), and the
 * coalescing rule that makes firing on every input affordable.
 *
 * WHAT A ROW OF THAT TABLE MEANS OPERATIONALLY: when this input moves, a rebuild is waiting in the
 * queue before the tick runs, scoped to the players and the scoring hashes that actually moved, and
 * firing the same event twice before the tick is one build rather than two.
 */
const PRIOR_SEASON = PRODUCT_SEASON - 1;
const NOW = new Date("2026-09-07T12:00:00.000Z");
const clock = { now: () => NOW.toISOString() };
const PPR_HASH = scoringHashOf(PPR_SCORING);
const STANDARD_HASH = scoringHashOf(STANDARD_SCORING);
const HALF_PPR_HASH = scoringHashOf(HALF_PPR_SCORING);

const db: Db = createTestDb();
let nextId = 0;

async function league(name: string, preset: "ppr" | "standard"): Promise<string> {
  const created = await createLeague({ db, clock, newId: () => `id_${++nextId}` }, {
    name, format: "snake", teamCount: 12, scoringPreset: preset, auctionBudget: null,
    rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  return created.leagueId;
}

function week(gsisId: string, season: number, stats: Readonly<Record<string, number>>): readonly PlayerWeekObservation[] {
  const asOf = new Date(Date.UTC(season, 10, 1));
  return Object.entries(stats).map(([field, value]) => ({
    season, week: 1, playerId: gsisId, source: DERIVED_STAT_LINE_SOURCE, metric: statMetricName(field), value, asOf,
  }));
}

async function seedBack(input: { readonly id: string; readonly nflId: string; readonly name: string; readonly rank: number }): Promise<void> {
  await db.insert(nflPlayers).values({ id: input.nflId, name: input.name, position: "RB" });
  await db.insert(players).values({ id: input.id, name: input.name, position: "RB", nflTeam: "SF", adp: 10 + input.rank });
  await db.insert(playerCrosswalk).values({ playerId: input.id, nflPlayerId: input.nflId, method: "espn_id", resolvedAt: NOW });
  await db.insert(preseasonProjections).values({
    season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: input.nflId, rank: input.rank, positionRank: input.rank,
    projectedPoints: 260, valueOverReplacement: 260, valueRank: input.rank, expectedGames: 17,
    floorPoints: 240, medianPoints: 260, ceilingPoints: 280, tier: 0,
    asOf: new Date("2026-08-01T00:00:00Z"), momentKind: "live",
  });
}

async function enqueuedJobs(): Promise<readonly (typeof jobs.$inferSelect)[]> {
  return await db.select().from(jobs).where(eq(jobs.name, PEEK_DOCUMENT_JOB_NAME));
}

async function hashesEnqueued(): Promise<ReadonlySet<string>> {
  return new Set((await enqueuedJobs()).map((job) => String((job.payload as { readonly scoringHash?: unknown }).scoringHash)));
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Manager 1" });
});

afterAll(async () => {
  await truncateAll(db);
});

describe("enqueuePeekDocumentRebuildsQuietly", () => {
  it("enqueues one job per scoring hash in use", async () => {
    await league("Sunday Money", "ppr");
    await league("Old School", "standard");

    const enqueued = await enqueuePeekDocumentRebuildsQuietly(db, clock, { playerIds: ["rb1"], reason: "facts:2026-09-07T04:00:00.000Z" });

    expect(enqueued).toBe(2);
    expect(await hashesEnqueued()).toEqual(new Set([PPR_HASH, STANDARD_HASH]));
  });

  it("coalesces two enqueues of the same hash and generation into one job", async () => {
    await league("Sunday Money", "ppr");
    const scope = { playerIds: ["rb1"], reason: "facts:2026-09-07T04:00:00.000Z" };

    expect(await enqueuePeekDocumentRebuildsQuietly(db, clock, scope)).toBe(1);
    expect(await enqueuePeekDocumentRebuildsQuietly(db, clock, scope)).toBe(0);
    expect(await enqueuedJobs()).toHaveLength(1);
  });

  it("does not coalesce a later generation of the same input", async () => {
    await league("Sunday Money", "ppr");

    await enqueuePeekDocumentRebuildsQuietly(db, clock, { playerIds: ["rb1"], reason: "facts:2026-09-07T04:00:00.000Z" });
    await enqueuePeekDocumentRebuildsQuietly(db, clock, { playerIds: ["rb1"], reason: "facts:2026-09-08T04:00:00.000Z" });

    expect(await enqueuedJobs()).toHaveLength(2);
  });

  it("enqueues exactly the hashes it was given, when it was given any", async () => {
    await league("Sunday Money", "ppr");
    await league("Old School", "standard");

    await enqueuePeekDocumentRebuildsQuietly(db, clock, { playerIds: null, scoringHashes: [STANDARD_HASH], reason: "settings:x" });

    expect(await hashesEnqueued()).toEqual(new Set([STANDARD_HASH]));
  });

  it("enqueues nothing when no league has a hash yet", async () => {
    await league("Sunday Money", "ppr");
    await db.update(leagues).set({ scoringHash: null });

    expect(await enqueuePeekDocumentRebuildsQuietly(db, clock, { playerIds: null, reason: "facts:x" })).toBe(0);
  });
});

describe("the event table", () => {
  beforeEach(async () => {
    await league("Sunday Money", "ppr");
    await seedBack({ id: "rb1", nflId: "00-6000001", name: "Volume Back", rank: 1 });
    await seedBack({ id: "rb2", nflId: "00-6000002", name: "Committee Back", rank: 2 });
    await recordObservations(db, [
      ...week("00-6000001", PRIOR_SEASON, { rushingYards: 100, receptions: 5, receivingYards: 40 }),
      ...week("00-6000002", PRIOR_SEASON, { rushingYards: 30, receptions: 1, receivingYards: 10 }),
    ]);
  });

  it("a written peek-facts row enqueues that player for every hash in use", async () => {
    await league("Old School", "standard");

    await writeRefresh(db, await collectBoardFacts(db, NOW));

    const enqueued = await enqueuedJobs();
    expect(await hashesEnqueued()).toEqual(new Set([PPR_HASH, STANDARD_HASH]));
    expect(enqueued[0]!.payload).toMatchObject({ reason: `facts:${NOW.toISOString()}` });
    expect([...(enqueued[0]!.payload as { readonly playerIds: readonly string[] }).playerIds].sort()).toEqual(["rb1", "rb2"]);
  });

  it("a peek-facts refresh that changed nothing enqueues nothing", async () => {
    const pass = await collectBoardFacts(db, NOW);
    await writeRefresh(db, pass);
    await db.delete(jobs);

    await writeRefresh(db, pass);

    expect(await enqueuedJobs()).toEqual([]);
  });

  it("a written capsule enqueues that player for every hash in use", async () => {
    // One player, and a gateway that refuses at once: this test is about the ENQUEUE, and the
    // capsule that gets written is the template floor either way (`generate.ts` never throws).
    const refuse: typeof globalThis.fetch = async () => new Response("no", { status: 400 });
    await runCapsuleSweepStep(db, clock, { apiKey: "test-key", fetch: refuse }, { budget: 1 });

    const capsuleJobs = (await enqueuedJobs()).filter((job) => String((job.payload as { readonly reason: string }).reason).startsWith("capsule:"));
    expect(capsuleJobs).toHaveLength(1);
    expect((capsuleJobs[0]!.payload as { readonly playerIds: readonly string[] }).playerIds).toHaveLength(1);
    expect(capsuleJobs[0]!.payload).toMatchObject({ reason: `capsule:${NOW.toISOString()}` });
  });

  it("a scoring settings CHANGE enqueues the new hash and no other", async () => {
    const leagueId = await league("Half Measures", "ppr");
    await db.delete(jobs);

    await writeLeagueScoring(db, clock, { leagueId, rules: HALF_PPR_SCORING });

    expect(await hashesEnqueued()).toEqual(new Set([HALF_PPR_HASH]));
    expect((await enqueuedJobs())[0]!.payload).toMatchObject({ playerIds: null, reason: `settings:${leagueId}:${HALF_PPR_HASH}` });
  });

  it("a league learning its own hash for the first time enqueues nothing", async () => {
    await db.delete(jobs);
    await league("Brand New", "ppr");

    expect(await enqueuedJobs()).toEqual([]);
  });

  it("an add, a drop and a trade enqueue no rebuild at all, because the holder is joined live", async () => {
    await db.delete(jobs);
    const [team] = await db.select({ id: teams.id }).from(teams);

    await db.insert(rosterSlots).values({ teamId: team!.id, playerId: "rb1", slot: "RB", slotIndex: 0 });
    await db.delete(rosterSlots).where(eq(rosterSlots.playerId, "rb1"));
    await db.insert(rosterSlots).values({ teamId: team!.id, playerId: "rb2", slot: "RB", slotIndex: 0 });

    expect(await enqueuedJobs()).toEqual([]);
  });
});

describe("the rebuild job itself", () => {
  beforeEach(async () => {
    await league("Sunday Money", "ppr");
    await seedBack({ id: "rb1", nflId: "00-6000001", name: "Volume Back", rank: 1 });
    await writeRefresh(db, await collectBoardFacts(db, NOW));
  });

  it("builds the documents the payload names", async () => {
    const outcome = await runPeekDocumentStep(db, clock, { scoringHash: PPR_HASH, playerIds: ["rb1"], reason: "test" });

    expect(outcome.summary).toContain("1 document built for 1 player");
    const rows = await db.select({ playerId: playerPeekDocuments.playerId }).from(playerPeekDocuments);
    expect(rows.map((row) => row.playerId)).toEqual(["rb1"]);
  });

  it("builds every player when the payload names none", async () => {
    const outcome = await runPeekDocumentStep(db, clock, { scoringHash: PPR_HASH, playerIds: null, reason: "test" });
    expect(outcome.summary).toContain("built for every player");
  });

  it("backfills a league whose hash was never computed, so a fresh deploy heals itself", async () => {
    await db.update(leagues).set({ scoringHash: null });

    const outcome = await runPeekDocumentStep(db, clock, { scoringHash: PPR_HASH, playerIds: null, reason: "test" });
    expect(outcome.summary).toContain("1 league scoring hash backfilled");
  });

  it("refuses a hash no league uses rather than building documents nobody can be served", async () => {
    await expect(runPeekDocumentStep(db, clock, { scoringHash: "a digest nobody uses", playerIds: null, reason: "test" })).rejects.toThrow(/no league uses scoring hash/);
  });
});

describe("parsePeekDocumentJobPayload", () => {
  it("accepts a whole-hash build", () => {
    expect(parsePeekDocumentJobPayload({ scoringHash: PPR_HASH, playerIds: null, reason: "facts:x" })).toEqual({
      scoringHash: PPR_HASH, playerIds: null, reason: "facts:x",
    });
  });

  it("refuses a payload with no hash, no reason, or a player list that is not one", () => {
    expect(() => parsePeekDocumentJobPayload({ playerIds: null, reason: "x" })).toThrow(/scoringHash/);
    expect(() => parsePeekDocumentJobPayload({ scoringHash: "h", playerIds: null })).toThrow(/reason/);
    expect(() => parsePeekDocumentJobPayload({ scoringHash: "h", playerIds: [1, 2], reason: "x" })).toThrow(/playerIds/);
  });
});
