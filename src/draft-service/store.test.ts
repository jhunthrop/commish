import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, draftActions, drafts, memberNotices, players, teams } from "@/db/schema";
import type { DraftAction, DraftPoolEntry } from "@/domain/draft";
import { currentDeadline, DRAFT_SKIP_POLICY, initialDraftState, type DraftConfig } from "@/draft-engine";
import type { MemberNotice } from "@/integrity-service/notify";
import { draftOrderFor } from "./order";
import { setSlotPreference, slotPreferencesFor } from "./slot-preference";
import { PUBLIC_ROOM_SHORT_REFUSAL } from "@/matchmaking/roll";
import { createDraftStore, isSequenceConflict, type ApplyResult, type DraftStore, type DraftStoreDeps, type PublishFn } from "./store";
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

/** Real names for `POOL`, so the notice-copy assertions below have something to match against. */
const PLAYER_NAMES: Readonly<Record<string, string>> = {
  qb1: "Quincy Bishop", rb1: "Reggie Barnes", wr1: "Wesley Reed",
  qb2: "Quentin Boyd", rb2: "Riley Banks", wr2: "Wyatt Ross",
};

let published: { type: string; leagueId: string; payload: unknown }[] = [];
const publish: PublishFn = async (input) => {
  published.push({ type: input.type, leagueId: input.leagueId, payload: input.payload });
  return "1-0";
};

/**
 * A fake for the store's injected `deliverNotice`, so this file's tests exercise the real
 * post-commit wiring (Task 8) without ever needing a live Redis connection — the real per-user
 * frame's actual delivery is proven against real Redis in `draft-realtime.test.ts` instead.
 */
let deliveredNotices: MemberNotice[] = [];
const deliverNoticeFake = async (notice: MemberNotice): Promise<void> => {
  deliveredNotices.push(notice);
};

function newStore(
  publishFn: PublishFn = publish,
  overrides: { deliverNotice?: (notice: MemberNotice) => Promise<void>; onPublishError?: DraftStoreDeps["onPublishError"] } = {},
) {
  return createDraftStore({
    db,
    publish: publishFn,
    clock,
    deliverNotice: overrides.deliverNotice ?? deliverNoticeFake,
    onPublishError: overrides.onPublishError,
  });
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

async function auctionFixture() {
  return seedDraftFixture(db, {
    draftId: "draft_auction",
    leagueId: "league_auction",
    format: "auction",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: 50,
  });
}

const start = (teamIds: readonly string[]): DraftAction => ({
  v: 1, type: "START_DRAFT", minBid: 1, skipPolicy: DRAFT_SKIP_POLICY, timestamp: T, draftOrder: teamIds, pool: POOL,
});
const pick = (teamId: string, playerId: string): DraftAction => ({ v: 1, type: "MAKE_PICK", timestamp: T, teamId, playerId });
const nominate = (teamId: string, playerId: string, openingBid: number): DraftAction => ({
  v: 1, type: "NOMINATE", timestamp: T, teamId, playerId, openingBid,
});
const bid = (teamId: string, amount: number): DraftAction => ({ v: 1, type: "BID", timestamp: T, teamId, amount });

/** The clock's own expiry, at whatever deadline the current state actually set — never a fixed
 *  timestamp, since `admitTimerExpire` rejects an expiry submitted before the real deadline. */
async function expireOnTheClock(store: DraftStore, draftId: string): Promise<ApplyResult> {
  const state = await store.getDraftState(draftId);
  return store.applyAction(draftId, { v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state!) ?? clock.now() });
}

/**
 * Queues the team currently on the clock for the pool's own top player (Task 5): this
 * fixture's kickoff sits 9+ days out, a slow tier, and a queueless team there is now
 * skip-eligible. The notice tests below are about the AUTOPICK path specifically, so they
 * queue the exact player the pool would have autopicked anyway — every downstream assertion
 * (which player, which position) stays byte-identical to what it was before Task 5 existed.
 */
async function queueOnClockTeam(store: DraftStore, draftId: string): Promise<void> {
  const state = await store.getDraftState(draftId);
  const onClockTeamId = state!.draftOrder[0]!;
  await store.applyAction(draftId, { v: 1, type: "SET_QUEUE", timestamp: T, teamId: onClockTeamId, playerIds: ["qb1"] });
}

async function actionRows(draftId: string) {
  return db.select().from(draftActions).where(eq(draftActions.draftId, draftId)).orderBy(asc(draftActions.sequence));
}

/** Runs the draft to completion on the clock alone — every pick this produces is `auto: true`. */
async function runFullDraft(store: DraftStore, draftId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const state = await store.getDraftState(draftId);
    if (state === null || state.phase === "complete") return;
    const result = await store.applyAction(draftId, {
      v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state) ?? clock.now(),
    });
    if (!result.ok) throw new Error(result.reason);
  }
  throw new Error("draft did not finish");
}

beforeEach(async () => {
  await truncateAll(db);
  published = [];
  deliveredNotices = [];
  // The `players` row every POOL entry needs for `autopickNoticeContext`'s join. Absent, the
  // autopick notice path skips itself rather than fail an already-decided pick over it (see
  // `store.ts`) — most tests above never look at `member_notices` and are unaffected either way;
  // seeding here lets the "draft store — notices" tests below assert the real thing.
  await db.insert(players).values(POOL.map((entry) => ({ id: entry.playerId, name: PLAYER_NAMES[entry.playerId]!, position: entry.position, nflTeam: "FA" })));
});

afterAll(async () => {
  await truncateAll(db);
});

describe("draft store — persistence", () => {
  it("returns null for a draft that doesn't exist", async () => {
    expect(await newStore().getDraftState("nope")).toBeNull();
  });

  it("refuses to apply an action against a draft that doesn't exist, inside the transaction's own lock", async () => {
    // The row locks themselves are what prove this: distinct from getDraftState's read-only
    // load(), applyAction's own "the row isn't there" check runs INSIDE the transaction, before
    // any action can be admitted or replayed against it. Since the final review's F1 the FIRST of
    // those locks is the league row, joined through `drafts.id`, so a missing draft is answered
    // there — one statement earlier than it used to be, and with the same sentence.
    const result = await newStore().applyAction("nope", start(["team_a", "team_b"]));
    expect(result).toEqual({ ok: false, reason: "That draft doesn't exist." });
  });

  it("refuses an action when the league lock finds its row but the draft row is gone, inside the same transaction", async () => {
    // The gap the F1 ordering opened: two statements now stand between "does this draft exist"
    // and "is its row locked", and a draft deleted in between (nothing in this product does that
    // outside a league cascade, which would take the league row too) must not fall through to a
    // replay. Real Postgres cannot split the two events any more than it can split the config
    // join below, so a stub `DbTx` is again the only way to drive the branch — the identical
    // technique, for the identical reason, as the case immediately after this one.
    const stubTx = {
      select: () => ({
        from: () => ({
          where: () => ({ for: () => Promise.resolve([]) }),
          innerJoin: () => ({
            where: () => Object.assign(Promise.resolve([]), { for: () => Promise.resolve([{ id: "league_vanished" }]) }),
          }),
        }),
      }),
    } as unknown as DbTx;
    const stubDb = { transaction: (fn: (tx: DbTx) => Promise<ApplyResult>) => fn(stubTx) } as unknown as Db;
    const store = createDraftStore({ db: stubDb, publish, clock });

    const result = await store.applyAction("draft_vanished", start(["team_a", "team_b"]));
    expect(result).toEqual({ ok: false, reason: "That draft doesn't exist." });
  });

  it("refuses an action when the row locks but its config join comes back empty, inside the same transaction", async () => {
    // `drafts.leagueId` is a NOT NULL foreign key to `leagues.id`, so `loadDraftConfig`'s inner
    // join can never miss for a row the FOR UPDATE select above it just found — through real
    // Postgres, `locked === undefined` and `state === null` are the same event. A stub `DbTx`
    // is the only way to split them and prove `load()`'s own null case is handled too.
    // TWO statements reach `innerJoin` now (final review F1): the `leagues FOR KEY SHARE` lock
    // that opens the transaction, which ends in `.for(...)` and must find its row, and
    // `loadDraftConfig`'s own config join, which is awaited directly and is the empty result this
    // test exists to drive. A drizzle query builder is itself thenable, so one object standing in
    // for both is the shape the real API already has.
    const stubTx = {
      select: () => ({
        from: () => ({
          where: () => ({ for: () => Promise.resolve([{ id: "draft_locked_ghost" }]) }),
          innerJoin: () => ({
            where: () => Object.assign(Promise.resolve([]), { for: () => Promise.resolve([{ id: "league_locked_ghost" }]) }),
          }),
        }),
      }),
    } as unknown as DbTx;
    const stubDb = { transaction: (fn: (tx: DbTx) => Promise<ApplyResult>) => fn(stubTx) } as unknown as Db;
    const store = createDraftStore({ db: stubDb, publish, clock });

    const result = await store.applyAction("draft_locked_ghost", start(["team_a", "team_b"]));
    expect(result).toEqual({ ok: false, reason: "That draft doesn't exist." });
  });

  it("skips the broadcast when the transaction resolves ok without ever setting `previous`", async () => {
    // `previous` is captured OUTSIDE the transaction and set only once the transaction's own
    // callback has loaded a real state — every REAL path that returns `ok: true` has therefore
    // already set it before this check runs. Stubbing `db.transaction` to resolve without ever
    // invoking the real callback is the only way to observe this guard's other branch, proving
    // `broadcast` genuinely depends on it rather than always running unconditionally.
    const config: DraftConfig = {
      draftId: "draft_stub", leagueId: "league_stub", format: "snake",
      kickoffAt: T, auctionBudget: null, slotConfig: [], clockSchedule: [],
    };
    const fakeState = initialDraftState(config);
    const stubDb = { transaction: async () => ({ ok: true, state: fakeState }) } as unknown as Db;
    const stubStore = createDraftStore({ db: stubDb, publish, clock });

    const result = await stubStore.applyAction("draft_stub", start(["team_a", "team_b"]));
    expect(result).toEqual({ ok: true, state: fakeState });
    expect(published).toEqual([]);
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

describe("draft store — sequence conflict (defensive backstop)", () => {
  it("translates a raw unique-index violation into the friendly rejection, not a driver error", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));

    // A genuine LIVE Postgres race on `draft_actions` can no longer be constructed here, and
    // that is Task 7 working as designed, not a gap: `draft_actions.draft_id` REFERENCES
    // `drafts.id`, so ANY insert into `draft_actions` for this draft first needs a lock on
    // that exact `drafts` row — the same row `applyAction`'s transaction now holds
    // `FOR UPDATE` for its entire duration. A second writer's insert therefore queues behind
    // that lock instead of racing it (confirmed empirically: attempting to race one in via a
    // proxied `tx.insert` deadlocked the test at the client level, because the second insert
    // blocked on the FK's implicit lock while the locked transaction sat waiting on that very
    // insert to return). So the only writer left who could ever trip this catch branch in real
    // operation is something that bypasses `draft_actions`'s own foreign key entirely — nothing
    // in this codebase does — which is exactly what the docblock in `store.ts` now says. This
    // test exercises the translation directly with the real driver-error shape
    // (`db/errors.ts`'s documented `.cause.code` / `.cause.constraint_name`) instead.
    const driverError = Object.assign(
      new Error('duplicate key value violates unique constraint "draft_actions_draft_sequence_idx"'),
      { cause: { code: "23505", constraint_name: "draft_actions_draft_sequence_idx" } },
    );
    const brokenDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "transaction") return () => Promise.reject(driverError);
        return Reflect.get(target, prop, receiver);
      },
    }) as Db;
    const brokenStore = createDraftStore({ db: brokenDb, publish, clock });

    const result = await brokenStore.applyAction(draftId, pick(teamIds[0]!, "qb1"));
    expect(result).toEqual({ ok: false, reason: "Someone else acted first. Try again." });
    expect(isSequenceConflict(driverError)).toBe(true);
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

  it("treats a cache entry for a never-started draft (sequence 0) as fresh, not perpetually stale", async () => {
    const { draftId } = await fixture(); // scheduled, no actions — an empty log
    const counting = countingDb(db);
    const store = createDraftStore({ db: counting.db, publish, clock });
    const first = await store.getDraftState(draftId);
    expect(first?.sequence).toBe(0);

    // `MAX(sequence)` over a draft with zero action rows still returns one row from Postgres,
    // with `latest: null` — not zero rows. `latestActionSequence`'s `row?.latest ?? 0` is what
    // turns that into `0`, matching a fresh cache's `sequence: 0`. Without that fallback this
    // read would see `null !== 0`, treat every hit on an unstarted draft as stale, and force a
    // full replay on every single read of it — so assert the same one-select cache-hit cost
    // proven above, not just that the returned value happens to match.
    const beforeHit = counting.selectCount();
    const second = await store.getDraftState(draftId);
    expect(second).toEqual(first);
    expect(counting.selectCount() - beforeHit).toBe(1);
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

describe("draft store — audit", () => {
  it("records every pick on the league's chain, in the transaction that accepted it", async () => {
    const { draftId, leagueId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    const result = await store.applyAction(draftId, pick(teamIds[0]!, "qb1"), { actor: { id: "user_alice" } });
    expect(result.ok).toBe(true);

    const rows = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"));
    expect(rows).toHaveLength(1);
    // Snake manual pick, unchanged by the auction-attribution fix: the submitting actor is
    // trusted directly, no team-owner lookup involved.
    expect(rows[0]).toMatchObject({ chainScope: leagueId, actorId: "user_alice", actorType: "user", sequence: expect.any(Number) });
  });

  it("records draft_completed in the same transaction that turns the draft into a season", async () => {
    const { draftId, leagueId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await runFullDraft(store, draftId);

    const [completed] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_completed"));
    expect(completed).toMatchObject({ chainScope: leagueId, actorType: "system", actorId: null });
    expect(completed!.payload).toMatchObject({ draftId, picks: expect.any(Number), teams: expect.any(Number) });

    // Snake auto path, unchanged by the auction-attribution fix: every pick this full run made
    // came from TIMER_EXPIRE with `auto: true`, so every one is system-attributed — the
    // auction-only owner lookup never fires here.
    const picks = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"));
    expect(picks.length).toBeGreaterThan(0);
    for (const p of picks) expect(p).toMatchObject({ actorType: "system", actorId: null });
  });

  it("records nothing for a rejected action", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    // Not this team's turn — rejected by the reducer before the action row (or any audit
    // event) is ever written.
    const result = await store.applyAction(draftId, pick(teamIds[1]!, "qb1"), { actor: { id: "user_alice" } });
    expect(result.ok).toBe(false);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"))).toHaveLength(0);
  });
});

describe("draft store — audit — auction attribution", () => {
  it("attributes a contested lot the clock closes to the winning bidder, not to no one", async () => {
    // Reproduces the reviewer's finding: team 1 nominates, team 2 outbids, and the CLOCK closes
    // the lot (TIMER_EXPIRE, submitted with no actor — the only way an auction pick is ever
    // awarded). The winner is team 2's owner, even though team 2 never submitted the closing
    // action itself.
    const { draftId, leagueId, teamIds, userIds } = await auctionFixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await store.applyAction(draftId, nominate(teamIds[0]!, "qb1", 1), { actor: { id: userIds[0]! } });
    await store.applyAction(draftId, bid(teamIds[1]!, 2), { actor: { id: userIds[1]! } });
    const closed = await expireOnTheClock(store, draftId);
    expect(closed.ok).toBe(true);

    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"));
    expect(row).toMatchObject({ chainScope: leagueId, actorId: userIds[1], actorType: "user" });
    expect(row!.payload).toMatchObject({ teamId: teamIds[1], playerId: "qb1", auto: false, price: 2 });
  });

  it("still attributes an unopposed floor award to the platform, not to the auto-nominated team's owner", async () => {
    // Nobody nominates, so the clock auto-nominates team 1's best player at the floor bid; nobody
    // outbids, so the clock closes it unopposed. `auto: true` end to end — system-attributed,
    // exactly like a snake auto-pick, and the owner lookup never fires.
    const { draftId, leagueId, teamIds } = await auctionFixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    const opened = await expireOnTheClock(store, draftId); // auto-nominates, opens the lot
    expect(opened.ok).toBe(true);
    const closed = await expireOnTheClock(store, draftId); // nobody bid — closes it unopposed
    expect(closed.ok).toBe(true);

    const [row] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"));
    expect(row).toMatchObject({ chainScope: leagueId, actorId: null, actorType: "system" });
    expect(row!.payload).toMatchObject({ teamId: teamIds[0], auto: true });
  });
});

describe("draft store — notices", () => {
  it("notifies the manager whose pick the clock made for them, in the same transaction — and rides no league-stream frame", async () => {
    const { draftId, leagueId, teamIds, userIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await queueOnClockTeam(store, draftId);
    const result = await expireOnTheClock(store, draftId);
    expect(result.ok).toBe(true);

    const [pickEvent] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"));
    const payload = pickEvent!.payload as unknown as { teamId: string; playerId: string; pickNumber: number };
    const pickerIndex = teamIds.indexOf(payload.teamId);

    const [notice] = await db.select().from(memberNotices);
    expect(notice).toMatchObject({
      userId: userIds[pickerIndex],
      leagueId,
      noticeType: "draft_auto_picked",
      title: "We made your pick for you",
      auditEventId: pickEvent!.eventId,
      readAt: null,
    });
    expect(notice!.body).toBe(
      `The clock ran out on pick ${payload.pickNumber} in league_1, so we used your queue and drafted ${PLAYER_NAMES[payload.playerId]} (${payload.playerId.startsWith("qb") ? "QB" : payload.playerId.startsWith("rb") ? "RB" : "WR"}). Set your queue before your next draft so this doesn't happen again.`,
    );

    // Ruling 13's guard: a private notice may not ride the league broadcast (every subscriber in
    // the room gets every frame — see `subscribe.ts`). The durable row above IS the delivery of
    // record; nothing on the league stream should even hint that a notice was created.
    expect(published.some((e) => e.type === "notice.created")).toBe(false);
    expect(published.some((e) => JSON.stringify(e.payload).includes(userIds[pickerIndex]!))).toBe(false);

    // Task 8's per-user delivery: `deliverNotice` is called AFTER the commit, beside `broadcast`,
    // with the exact durable row just asserted above — proven here through the injected fake
    // (see `deliverNoticeFake`); the real per-user Redis frame is proven end to end, against real
    // Redis, in `draft-realtime.test.ts`.
    expect(deliveredNotices).toEqual([expect.objectContaining({ id: notice!.id, userId: userIds[pickerIndex], leagueId, noticeType: "draft_auto_picked" })]);
  });

  it("writes no notice for a pick a person submitted directly, and rides no league-stream frame either way", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await store.applyAction(draftId, pick(teamIds[0]!, "qb1"), { actor: { id: "user_alice" } });

    expect(await db.select().from(memberNotices)).toHaveLength(0);
    expect(published.some((e) => e.type === "notice.created")).toBe(false);
    expect(deliveredNotices).toHaveLength(0);
  });

  it("skips the notice, without failing the pick, when the join finds no row (e.g. an unseeded player)", async () => {
    const { draftId, teamIds } = await fixture();
    // Undo this file's own beforeEach seeding, reproducing the gap `autopickNoticeContext`
    // guards — this must never turn an already-decided pick into a rolled-back transaction.
    await db.delete(players);
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await queueOnClockTeam(store, draftId);
    const result = await expireOnTheClock(store, draftId);

    expect(result.ok).toBe(true);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"))).toHaveLength(1);
    expect(await db.select().from(memberNotices)).toHaveLength(0);
    expect(deliveredNotices).toHaveLength(0);
  });

  it("never delivers a live frame for a notice whose transaction did not commit", async () => {
    // `alsoInTransaction` runs INSIDE the same transaction as the pick, the audit events and any
    // notice — throwing there rolls back everything, including the durable notice row. Proves
    // `deliverNotice` is called from OUTSIDE the transaction, driven off `createdNotices` (a
    // plain array built as rows are returned), and never fires for a notice that was rolled back
    // with the write it explains.
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    const state = await store.getDraftState(draftId);
    await expect(
      store.applyAction(
        draftId,
        { v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state!) ?? clock.now() },
        { alsoInTransaction: async () => { throw new Error("boom"); } },
      ),
    ).rejects.toThrow("boom");

    expect(await db.select().from(memberNotices)).toHaveLength(0);
    expect(deliveredNotices).toHaveLength(0);
  });

  it("a deliverNotice failure never fails, and never rolls back, an already-committed pick", async () => {
    // The inverse of `notifyAffectedMember`'s own discipline, pinned as a regression guard: the
    // durable row and the pick are ALREADY COMMITTED by the time `deliver` runs (it's called
    // strictly after `db.transaction` resolves — see the code right above `createdNotices`'s
    // loop), so a rejecting `deliverNotice` must be swallowed exactly like a Redis outage in
    // `broadcast`, reported through the same `onPublishError` sink, and never surface as a
    // rejection of `applyAction` or undo anything already written.
    const publishFailures: { type: string; leagueId: string }[] = [];
    const throwingDeliverNotice = async (): Promise<void> => {
      throw new Error("Redis is unreachable");
    };
    const { draftId, leagueId, teamIds, userIds } = await fixture();
    const store = newStore(publish, {
      deliverNotice: throwingDeliverNotice,
      onPublishError: (_error, event) => publishFailures.push({ type: event.type, leagueId: event.leagueId }),
    });
    await store.applyAction(draftId, start(teamIds));
    await queueOnClockTeam(store, draftId);

    const result = await expireOnTheClock(store, draftId);

    // No throw escaped `applyAction`, and the pick is genuinely accepted — not merely
    // "didn't throw": ok:true is the store's own verdict that this action was admitted.
    expect(result.ok).toBe(true);

    const [pickEvent] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"));
    expect(pickEvent).toBeDefined();
    const payload = pickEvent!.payload as unknown as { teamId: string };
    const pickerIndex = teamIds.indexOf(payload.teamId);

    // The durable notice row landed — it was written and committed BEFORE `deliver` ever ran,
    // so a delivery failure has no way to touch it.
    const [notice] = await db.select().from(memberNotices);
    expect(notice).toMatchObject({ userId: userIds[pickerIndex], leagueId, noticeType: "draft_auto_picked" });

    // The failure was reported through the existing sink, not swallowed silently, and not
    // thrown back at the caller.
    expect(publishFailures).toEqual([{ type: "notice.created", leagueId }]);
  });

  it("falls back to an empty string in the failure sink when a notice's leagueId is somehow absent", async () => {
    // `MemberNotice.leagueId` is nullable in the wider type (a platform-level notice carries
    // none); THIS notice type always carries a real one — `notifyAffectedMember` is called with
    // `result.state.config.leagueId`, a NOT NULL column. Mutating the notice inside the
    // injected `deliverNotice` (the object the failure-sink read comes from) is the only way to
    // put that read in the state it defends against, without inventing a notice type that could
    // actually produce a null leagueId here.
    const publishFailures: { type: string; leagueId: string }[] = [];
    const { draftId, teamIds } = await fixture();
    const store = newStore(publish, {
      deliverNotice: async (notice) => {
        (notice as { leagueId: string | null }).leagueId = null;
        throw new Error("Redis is unreachable");
      },
      onPublishError: (_error, event) => publishFailures.push({ type: event.type, leagueId: event.leagueId }),
    });
    await store.applyAction(draftId, start(teamIds));
    const result = await expireOnTheClock(store, draftId);
    expect(result.ok).toBe(true);
    expect(publishFailures).toEqual([{ type: "notice.created", leagueId: "" }]);
  });

  it("notifies the skipped manager and writes a subject-scoped system_action, in the same transaction (Task 5)", async () => {
    // No queue: the 8h tier here is well past the skip floor, so the on-clock team is
    // skip-eligible and this expiry owes the pick instead of making it.
    const { draftId, leagueId, teamIds, userIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    const before = await store.getDraftState(draftId);
    const onClockTeamId = before!.draftOrder[0]!;
    const pickerIndex = teamIds.indexOf(onClockTeamId);

    const result = await expireOnTheClock(store, draftId);
    expect(result.ok).toBe(true);

    const [skipEvent] = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "system_action"));
    expect(skipEvent).toMatchObject({ chainScope: leagueId, actorId: null, actorType: "system" });
    expect(skipEvent!.payload).toMatchObject({ action: "draft_pick_skipped", subjectUserId: userIds[pickerIndex], pickNumber: 1 });

    const [notice] = await db.select().from(memberNotices);
    expect(notice).toMatchObject({
      userId: userIds[pickerIndex], leagueId, noticeType: "draft_pick_skipped",
      title: "Your pick passed in league_1", auditEventId: skipEvent!.eventId, readAt: null,
    });
    expect(notice!.body).toBe("Your pick passed while you were away. You can still make it, and the draft will wait for it before it finishes.");

    // Ruling 13's guard, the same one every other draft notice keeps: never on the league stream.
    expect(published.some((e) => e.type === "notice.created")).toBe(false);
    expect(deliveredNotices).toEqual([expect.objectContaining({ id: notice!.id, userId: userIds[pickerIndex], leagueId, noticeType: "draft_pick_skipped" })]);

    // The pick itself is owed, not made: nobody was drafted, and the draft moved on.
    const after = await store.getDraftState(draftId);
    expect(after?.owedPicks[onClockTeamId]).toEqual([1]);
    expect(after?.picks).toHaveLength(0);
  });

  it("skips the skip's own notice, without failing the skip, when the team lookup finds no row (Task 5)", async () => {
    // No queue this time (deliberately NOT `queueOnClockTeam`): the 8h tier here is slow enough
    // that the on-clock team is skip-eligible, and this test is about THAT path's own notice —
    // `skipNoticeContext`'s join, the skip's twin of `autopickNoticeContext` above.
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    const before = await store.getDraftState(draftId);
    const onClockTeamId = before!.draftOrder[0]!;
    // Reproducing the gap `skipNoticeContext` guards — a genuine skip must never turn into a
    // rolled-back transaction over a notification nicety.
    await db.delete(teams).where(eq(teams.id, onClockTeamId));

    const result = await expireOnTheClock(store, draftId);

    expect(result.ok).toBe(true);
    const after = await store.getDraftState(draftId);
    expect(after?.owedPicks[onClockTeamId]).toEqual([1]);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "system_action"))).toHaveLength(0);
    expect(await db.select().from(memberNotices)).toHaveLength(0);
    expect(deliveredNotices).toHaveLength(0);
  });
});

describe("draft store — slot preferences (Task 6)", () => {
  it("feeds saved slot preferences into the draw when the draft actually starts", async () => {
    const { draftId, leagueId, teamIds, userIds } = await seedDraftFixture(db, {
      draftId: "draft_kds",
      leagueId: "league_kds",
      format: "snake",
      teamCount: 3,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
    });
    // Three teams x three roster slots each — `reduceStart` refuses a pool smaller than that,
    // and `beforeEach`'s own six-player POOL was sized for the two-team `fixture()` above.
    await db.insert(players).values([
      { id: "qb3", name: "QB Three", position: "QB", nflTeam: "FA" },
      { id: "rb3", name: "RB Three", position: "RB", nflTeam: "FA" },
      { id: "wr3", name: "WR Three", position: "WR", nflTeam: "FA" },
    ]);
    // The BARE shuffle for this exact draft id/team set (proven by the next test in this
    // block, and independently below) draws `[team_3, team_2, team_1]` and — with nobody
    // ranking anything — would seat `team_1` in slot 3. Ranking `team_3` (drawn FIRST) for
    // slot 3 instead is what actually changes the outcome: an assertion that only ever
    // reproduced the bare shuffle's own result would pass whether or not `startDraft` reads
    // preferences at all.
    const preferred = await setSlotPreference(db, { leagueId, userId: userIds[2]!, ranking: [3] });
    expect(preferred.ok).toBe(true);

    const store = newStore();
    const result = await store.startDraft(draftId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable — asserted above");
    // The exact same draw `draftOrderFor` produces from this draft's id, its teams, and
    // whatever `slotPreferencesFor` reads back — proving `startDraft` actually consults the
    // saved preference rather than falling back to the bare shuffle.
    const expectedOrder = draftOrderFor(draftId, teamIds, await slotPreferencesFor(db, draftId));
    expect(result.state.draftOrder).toEqual(expectedOrder);
    expect(result.state.draftOrder).not.toEqual(draftOrderFor(draftId, teamIds));
    expect(result.state.draftOrder[2]).toBe(teamIds[2]);
  });

  it("drafts in exactly the bare shuffle's order when nobody ever ranked anything — additive by construction", async () => {
    const { draftId, teamIds } = await seedDraftFixture(db, {
      draftId: "draft_no_kds",
      leagueId: "league_no_kds",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
    });

    const result = await newStore().startDraft(draftId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable — asserted above");
    expect(result.state.draftOrder).toEqual(draftOrderFor(draftId, teamIds));
  });
});

describe("draft store — the public-room-short refusal (Task 7 fix round 1, M5)", () => {
  it("refuses a public matchmade member league's manual press while a seat is still open", async () => {
    const { draftId } = await seedDraftFixture(db, {
      draftId: "draft_public_short",
      leagueId: "league_public_short",
      format: "snake",
      teamCount: 12,
      filledTeams: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
      isPublicMatchmade: true,
    });

    const result = await newStore().startDraft(draftId);

    expect(result).toEqual({ ok: false, reason: PUBLIC_ROOM_SHORT_REFUSAL });
    const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, draftId));
    expect(row?.status).toBe("scheduled");
    expect(await db.select().from(draftActions).where(eq(draftActions.draftId, draftId))).toEqual([]);
  });

  it("never applies the public-room-short refusal to the platform's own auto-start path", async () => {
    // `options.auto === true` is the ONLY path `dueDraftsQuery` (`@/draft-service/auto-start`)
    // reaches after Task 7's own fix — it never finds an unfilled room to begin with — but this
    // proves the SCOPE of the check itself, not merely that the caller happens to be well-behaved.
    const { draftId } = await seedDraftFixture(db, {
      draftId: "draft_public_auto",
      leagueId: "league_public_auto",
      format: "snake",
      teamCount: 12,
      filledTeams: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
      isPublicMatchmade: true,
    });

    const result = await newStore().startDraft(draftId, { auto: true });

    expect(result.ok).toBe(true);
  });

  it("still lets a PRIVATE commissioner start a short room by hand, floor and warning unchanged", async () => {
    const { draftId } = await seedDraftFixture(db, {
      draftId: "draft_private_short",
      leagueId: "league_private_short",
      format: "snake",
      teamCount: 12,
      filledTeams: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
      isPublicMatchmade: false,
    });

    const result = await newStore().startDraft(draftId);

    expect(result.ok).toBe(true);
  });
});
