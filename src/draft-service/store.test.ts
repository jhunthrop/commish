import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { auditEvents, draftActions, memberNotices, players } from "@/db/schema";
import type { DraftAction, DraftPoolEntry } from "@/domain/draft";
import { currentDeadline } from "@/draft-engine";
import { createDraftStore, isSequenceConflict, type ApplyResult, type DraftStore, type PublishFn } from "./store";
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
  v: 1, type: "START_DRAFT", minBid: 1, timestamp: T, draftOrder: teamIds, pool: POOL,
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
  it("notifies the manager whose pick the clock made for them, in the same transaction, and pushes a live frame", async () => {
    const { draftId, leagueId, teamIds, userIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
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
      title: "Your pick was made automatically",
      auditEventId: pickEvent!.eventId,
      readAt: null,
    });
    expect(notice!.body).toBe(
      `The clock ran out on pick ${payload.pickNumber} in league_1, so we used your queue and drafted ${PLAYER_NAMES[payload.playerId]} (${payload.playerId.startsWith("qb") ? "QB" : payload.playerId.startsWith("rb") ? "RB" : "WR"}).`,
    );

    // The same live frame `broadcast` already uses, after the same commit — no separate
    // per-user channel, just the league stream with the target `userId` in the payload.
    const frame = published.find((e) => e.type === "notice.created");
    expect(frame).toBeDefined();
    expect(frame!.leagueId).toBe(leagueId);
    expect(frame!.payload).toMatchObject({ userId: userIds[pickerIndex], noticeType: "draft_auto_picked" });
  });

  it("writes no notice for a pick a person submitted directly", async () => {
    const { draftId, teamIds } = await fixture();
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    await store.applyAction(draftId, pick(teamIds[0]!, "qb1"), { actor: { id: "user_alice" } });

    expect(await db.select().from(memberNotices)).toHaveLength(0);
    expect(published.some((e) => e.type === "notice.created")).toBe(false);
  });

  it("skips the notice, without failing the pick, when the join finds no row (e.g. an unseeded player)", async () => {
    const { draftId, teamIds } = await fixture();
    // Undo this file's own beforeEach seeding, reproducing the gap `autopickNoticeContext`
    // guards — this must never turn an already-decided pick into a rolled-back transaction.
    await db.delete(players);
    const store = newStore();
    await store.applyAction(draftId, start(teamIds));
    const result = await expireOnTheClock(store, draftId);

    expect(result.ok).toBe(true);
    expect(await db.select().from(auditEvents).where(eq(auditEvents.eventType, "draft_pick"))).toHaveLength(1);
    expect(await db.select().from(memberNotices)).toHaveLength(0);
  });
});
