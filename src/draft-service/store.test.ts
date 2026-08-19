import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftActions } from "@/db/schema";
import type { DraftAction, DraftPoolEntry } from "@/domain/draft";
import { createDraftStore, isSequenceConflict, type PublishFn } from "./store";
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
 * A `Db` proxy that counts every `.select(...)` call made through it, so a test can tell a
 * cache hit (one `MAX(sequence)` probe) apart from a full replay (config + action-row selects
 * on top of that probe) without reaching into `store.ts` internals.
 */
function countingDb(base: Db): { db: Db; selectCount: () => number } {
  let selects = 0;
  const proxy = new Proxy(base, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (prop === "select" && typeof value === "function") {
        return (...args: unknown[]) => {
          selects += 1;
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value;
    },
  }) as Db;
  return { db: proxy, selectCount: () => selects };
}

/**
 * A `Db` whose `transaction(...)` always rejects with a connection-style error rather than a
 * Postgres unique violation — the store's non-race failure path, distinct from the
 * (draft_id, sequence) backstop exercised elsewhere. `applyAction` does its append inside
 * `db.transaction`, so this is the seam that actually fails when the connection drops —
 * intercepting `insert` alone would miss it, because the transaction callback receives its
 * own `tx` handle, never `db.insert` itself.
 */
function storeWithBrokenInsert() {
  const brokenDb = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "transaction") {
        return () => Promise.reject(new Error("connection reset by peer"));
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
  v: 1, type: "START_DRAFT", minBid: 1, timestamp: T, draftOrder: teamIds, pool: POOL,
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
    const publishedBeforeRejection = published.length;
    const result = await store.applyAction(draftId, pick(teamIds[1]!, "qb1"));
    expect(result).toEqual({ ok: false, reason: "It's not your turn to pick." });
    expect(await actionRows(draftId)).toHaveLength(1);
    // The rejected action contributes no new publish — only START_DRAFT (above) did.
    expect(published).toHaveLength(publishedBeforeRejection);
  });

  it("publishes draft events after the write, on the league stream", async () => {
    const { draftId, teamIds, leagueId } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await store.applyAction(draftId, pick(teamIds[0]!, "qb1"));
    expect(published.map((e) => e.type)).toEqual(["draft.status", "draft.pick"]);
    expect(published.every((e) => e.leagueId === leagueId)).toBe(true);
    expect(published[1]?.payload).toMatchObject({
      draftId, playerId: "qb1", teamId: teamIds[0], slotIndex: 0,
      clock: expect.objectContaining({ sequence: 2 }),
    });
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
    // The failed write must not poison the cache: if it had, a later read would keep
    // returning the pre-failure state even after the log changed underneath it. Insert a
    // row out-of-band (bypassing the store entirely) and confirm the next read reflects it —
    // proof the cache was actually cleared, not merely "still equal to what it was before".
    await db.insert(draftActions).values({
      draftId,
      sequence: 2,
      action: pick(teamIds[0]!, "qb1"),
      timestamp: new Date(T),
    });
    const state = await broken.getDraftState(draftId);
    expect(state?.sequence).toBe(2);
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

  it("lets exactly one of two independent stores' picks through, in-process lock or not", async () => {
    const { draftId, teamIds } = await fixture();
    const storeA = newStore();
    const storeB = newStore();
    await storeA.applyAction(draftId, start(teamIds));
    // Warm B's cache to sequence 1 — the in-process lock can't help across processes, so
    // something else has to stop a double append.
    await storeB.getDraftState(draftId);
    const results = await Promise.all([
      storeA.applyAction(draftId, pick(teamIds[0]!, "qb1")),
      storeB.applyAction(draftId, pick(teamIds[0]!, "rb1")),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const loser = results.find((r) => !r.ok);
    // Which mechanism catches the loser is a timing race, not a contract: if B's freshness
    // probe (Task 6) runs before A's write commits, both still see sequence 1 and race the
    // insert, so the database's unique index on (draft_id, sequence) is what stops the
    // double append — the loser gets "Someone else acted first." If B's probe instead runs
    // AFTER A's commit, B self-heals by replaying A's pick before it ever attempts its own
    // write, and is rejected by ordinary game rules instead — "It's not your turn to pick."
    // Either way exactly one pick lands; only the *reason* the loser sees is nondeterministic.
    // (Empirically this always lands on the second path, because the probe query gives A's
    // already-scheduled write enough of a head start to commit first — but nothing here
    // guarantees that, so the assertion accepts both.)
    expect(["Someone else acted first. Try again.", "It's not your turn to pick."]).toContain(
      loser && !loser.ok ? loser.reason : undefined,
    );
    expect(await actionRows(draftId)).toHaveLength(2);
    // One event for START_DRAFT plus one for the winning pick — the loser's rejected
    // write never reaches `broadcast`, so it contributes nothing.
    expect(published).toHaveLength(2);
  });
});

describe("draft store — cache freshness", () => {
  it("serves the cache on a hit instead of replaying the log, and replays on a miss", async () => {
    const { draftId, teamIds } = await fixture();
    const counting = countingDb(db);
    const store = createDraftStore({ db: counting.db, publish, clock });
    await store.applyAction(draftId, start(teamIds)); // `applyAction` already sets the cache

    const beforeHit = counting.selectCount();
    await store.getDraftState(draftId);
    // A cache hit costs exactly one indexed `MAX(sequence)` probe — not the config + action-row
    // selects a full replay would also need.
    const hitSelects = counting.selectCount() - beforeHit;
    expect(hitSelects).toBe(1);

    // Force a genuine miss: drop the cache and read again — this must fall through to a full
    // replay (the probe is skipped entirely because there's nothing cached to validate).
    store.invalidate(draftId);
    const beforeMiss = counting.selectCount();
    await store.getDraftState(draftId);
    const missSelects = counting.selectCount() - beforeMiss;
    expect(missSelects).toBeGreaterThan(hitSelects);
  });
});

describe("isSequenceConflict", () => {
  /** Shapes a fake error the way `postgres-js` actually does — `code`/`constraint_name` one level under `.cause`. */
  const driverError = (code: string, constraintName: string) => ({ cause: { code, constraint_name: constraintName } });

  it("is true for the exact race applyAction retries on", () => {
    expect(isSequenceConflict(driverError("23505", "draft_actions_draft_sequence_idx"))).toBe(true);
  });

  it("is false for a different unique-index violation with the same SQLSTATE — must not be mislabeled as a retryable race", () => {
    expect(isSequenceConflict(driverError("23505", "draft_picks_draft_player_idx"))).toBe(false);
  });

  it("is false for a non-unique-violation error, even on the right table", () => {
    expect(isSequenceConflict(driverError("23503", "draft_actions_draft_sequence_idx"))).toBe(false);
  });

  it("is false for errors with no driver shape at all", () => {
    expect(isSequenceConflict(new Error("connection reset by peer"))).toBe(false);
    expect(isSequenceConflict(null)).toBe(false);
    expect(isSequenceConflict(undefined)).toBe(false);
    expect(isSequenceConflict("not an object")).toBe(false);
  });

  it("finds the fields whether they sit on the error directly or one .cause down", () => {
    expect(isSequenceConflict({ code: "23505", constraint_name: "draft_actions_draft_sequence_idx" })).toBe(true);
  });
});
