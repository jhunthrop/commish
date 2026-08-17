import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftActions } from "@/db/schema";
import type { DraftAction, DraftPoolEntry } from "@/domain/draft";
import { createDraftStore, type PublishFn } from "./store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const clock = { now: () => "2026-09-01T00:00:00.000Z" };
const T = "2026-09-01T00:00:00.000Z";

const POOL: readonly DraftPoolEntry[] = [
  { playerId: "qb1", position: "QB" },
  { playerId: "rb1", position: "RB" },
  { playerId: "wr1", position: "WR" },
  { playerId: "qb2", position: "QB" },
  { playerId: "rb2", position: "RB" },
  { playerId: "wr2", position: "WR" },
];

let published: { type: string; leagueId: string; payload: unknown }[] = [];
const publish: PublishFn = async (input) => {
  published.push({ type: input.type, leagueId: input.leagueId, payload: input.payload });
  return "1-0";
};

function newStore(publishFn: PublishFn = publish) {
  return createDraftStore({ db, publish: publishFn, clock });
}

/**
 * A `Db` whose `insert(draftActions)` always rejects with a connection-style error rather
 * than a Postgres unique violation — the store's non-race failure path, distinct from the
 * (draft_id, sequence) backstop exercised elsewhere.
 */
function storeWithBrokenInsert() {
  const brokenDb = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "insert") {
        return () => ({ values: () => Promise.reject(new Error("connection reset by peer")) });
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Db;
  return createDraftStore({ db: brokenDb, publish, clock });
}

async function fixture() {
  return seedDraftFixture(db, {
    draftId: "draft_1",
    leagueId: "league_1",
    format: "snake",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
  });
}

const start = (teamIds: readonly string[]): DraftAction => ({
  v: 1, type: "START_DRAFT", timestamp: T, draftOrder: teamIds, pool: POOL,
});
const pick = (teamId: string, playerId: string): DraftAction => ({ v: 1, type: "MAKE_PICK", timestamp: T, teamId, playerId });

async function actionRows(draftId: string) {
  return db.select().from(draftActions).where(eq(draftActions.draftId, draftId)).orderBy(asc(draftActions.sequence));
}

beforeEach(async () => {
  await truncateAll(db);
  published = [];
});

afterAll(async () => {
  await truncateAll(db);
});

describe("draft store — persistence", () => {
  it("returns null for a draft that doesn't exist", async () => {
    expect(await newStore().getDraftState("nope")).toBeNull();
  });

  it("appends one numbered action row per accepted action and materializes the state", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    expect((await store.applyAction(draftId, start(teamIds))).ok).toBe(true);
    const result = await store.applyAction(draftId, pick(teamIds[0]!, "qb1"));
    expect(result.ok).toBe(true);
    const rows = await actionRows(draftId);
    expect(rows.map((r) => r.sequence)).toEqual([1, 2]);
    expect(rows[1]?.action).toEqual(pick(teamIds[0]!, "qb1"));
    const state = await store.getDraftState(draftId);
    expect(state?.sequence).toBe(2);
    expect(state?.picks).toHaveLength(1);
  });

  it("persists nothing when the reducer rejects the action", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    const result = await store.applyAction(draftId, pick(teamIds[1]!, "qb1"));
    expect(result).toEqual({ ok: false, reason: "It's not your turn to pick." });
    expect(await actionRows(draftId)).toHaveLength(1);
  });

  it("publishes draft events after the write, on the league stream", async () => {
    const { draftId, teamIds, leagueId } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await store.applyAction(draftId, pick(teamIds[0]!, "qb1"));
    expect(published.map((e) => e.type)).toEqual(["draft.status", "draft.pick"]);
    expect(published.every((e) => e.leagueId === leagueId)).toBe(true);
    expect(published[1]?.payload).toMatchObject({ draftId, playerId: "qb1", teamId: teamIds[0], sequence: 2 });
  });

  it("accepts the action even when publishing blows up — Postgres is authoritative", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore(async () => {
      throw new Error("redis is down");
    });
    expect((await store.applyAction(draftId, start(teamIds))).ok).toBe(true);
    const result = await store.applyAction(draftId, pick(teamIds[0]!, "qb1"));
    expect(result.ok).toBe(true);
    expect(await actionRows(draftId)).toHaveLength(2);
  });

  it("throws and persists nothing when the database insert fails for a reason other than a race", async () => {
    const { draftId, teamIds } = await fixture();
    await newStore().applyAction(draftId, start(teamIds));
    const broken = storeWithBrokenInsert();
    published = [];

    await expect(broken.applyAction(draftId, pick(teamIds[0]!, "qb1"))).rejects.toThrow("connection reset by peer");

    expect(await actionRows(draftId)).toHaveLength(1);
    expect(published).toHaveLength(0);
    // The failed write must not poison the cache: the next read still replays the true log.
    const state = await broken.getDraftState(draftId);
    expect(state?.sequence).toBe(1);
  });
});

describe("draft store — crash recovery", () => {
  it("rebuilds identical state from the action log alone after the cache is lost", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await store.applyAction(draftId, pick(teamIds[0]!, "qb1"));
    await store.applyAction(draftId, pick(teamIds[1]!, "rb1"));
    const before = await store.getDraftState(draftId);

    // Simulate a process restart: a brand-new store, same database, empty cache.
    const restarted = newStore();
    expect(await restarted.getDraftState(draftId)).toEqual(before);

    // And an explicit cache drop on the original store reconstructs the same state.
    store.invalidate(draftId);
    expect(await store.getDraftState(draftId)).toEqual(before);
  });
});

describe("draft store — concurrency", () => {
  it("lets only one of two simultaneous submissions through, in-process", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    const [a, b] = await Promise.all([
      store.applyAction(draftId, pick(teamIds[0]!, "qb1")),
      store.applyAction(draftId, pick(teamIds[0]!, "rb1")),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await actionRows(draftId)).toHaveLength(2);
  });

  it("stops a double append at the database when two independent stores race", async () => {
    const { draftId, teamIds } = await fixture();
    const storeA = newStore();
    const storeB = newStore();
    await storeA.applyAction(draftId, start(teamIds));
    // Warm B's cache so both stores believe the next sequence is 2 — the in-process lock
    // can't help across processes; the unique index is what must stop this.
    await storeB.getDraftState(draftId);
    const results = await Promise.all([
      storeA.applyAction(draftId, pick(teamIds[0]!, "qb1")),
      storeB.applyAction(draftId, pick(teamIds[0]!, "rb1")),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    expect(loser).toEqual({ ok: false, reason: "Someone else acted first. Try again." });
    expect(await actionRows(draftId)).toHaveLength(2);
  });
});
