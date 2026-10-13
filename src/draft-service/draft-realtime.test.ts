import { describe, it, expect, beforeEach, afterAll } from "vitest";
import Redis from "ioredis";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research-ts/db/schema";
import type { RosterSlotConfig } from "@research-ts/domain/roster";
import { bestAvailableFor, currentDeadline, teamOnClock, type DraftState } from "@/draft-engine";
import { deliverNotice } from "@/integrity-service/notify";
import { createPublisher } from "@/lib/realtime/publish";
import { subscribe } from "@/lib/realtime/subscribe";
import { REALTIME_CONFIG } from "@/lib/realtime/config";
import type { RealtimeEvent } from "@/lib/realtime/events";
import { createDraftStore } from "./store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const db = createTestDb();
const control = new Redis(REDIS_URL);
const clock = { now: () => "2026-09-01T00:00:00.000Z" };
const publisher = createPublisher({ redis: new Redis(REDIS_URL), clock });
const store = () =>
  createDraftStore({
    db,
    publish: (input) => publisher.publish(input),
    clock,
    // Task 8: real per-user delivery over the SAME real Redis connection the rest of this file
    // already uses, so the "two SSE clients" proof below is genuine end to end, not a fake.
    deliverNotice: (notice) => deliverNotice(notice, (input) => publisher.publishToUser(input)),
  });

const AUCTION_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 1, eligiblePositions: ["RB"] },
];

/** Enough players that a 12-team, 3-round draft and a 4-team auction both fill. */
async function insertPlayers(count: number): Promise<void> {
  const positions = ["QB", "RB", "WR"] as const;
  await db.insert(players).values(
    Array.from({ length: count }, (_, i) => ({
      id: `p${String(i + 1).padStart(3, "0")}`,
      name: `Player ${i + 1}`,
      position: positions[i % positions.length]!,
      nflTeam: "KC",
    })),
  );
}

/** Flips true the moment a watcher has received its first stream entry — see `watchUntilComplete`. */
interface Watcher {
  ready: boolean;
}

/**
 * One SSE-equivalent client: reads the league stream until the draft is announced complete.
 * `watcher.ready` flips true on the first entry received (real or probe) — a marker that this
 * connection's blocking XREAD has actually registered with Redis, used by
 * `waitUntilSubscribersReady` below in place of a fixed sleep. Probe entries (see there) are
 * never real draft events and are filtered out before being recorded.
 */
async function watchUntilComplete(leagueId: string, signal: AbortSignal, watcher: Watcher): Promise<readonly RealtimeEvent[]> {
  const seen: RealtimeEvent[] = [];
  const redis = new Redis(REDIS_URL);
  try {
    for await (const event of subscribe({ redis, streamKey: REALTIME_CONFIG.leagueStreamKey(leagueId), afterId: "$", signal })) {
      watcher.ready = true;
      if ((event.payload as { probe?: boolean } | null)?.probe === true) continue;
      seen.push(event);
      if (event.type === "draft.status" && (event.payload as { phase?: string }).phase === "complete") break;
    }
  } finally {
    redis.disconnect();
  }
  return seen;
}

/**
 * Deterministic replacement for a fixed `setTimeout` warm-up: republishes a probe event onto
 * the league stream until every given watcher has observed at least one stream entry (proving
 * its `subscribe()` XREAD has registered with Redis), so the caller can be sure no *real*
 * event published next will be missed by a subscriber that hadn't started listening yet.
 * Bounded by `timeoutMs` so a genuinely stuck subscriber fails the test with a clear message
 * instead of hanging the suite.
 */
async function waitUntilSubscribersReady(leagueId: string, watchers: readonly Watcher[], timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (watchers.some((w) => !w.ready)) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${watchers.length} SSE subscriber(s) on league "${leagueId}" to register.`,
      );
    }
    await publisher.publish({ leagueId, type: "draft.status", payload: { probe: true } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function picksFromEvents(events: readonly RealtimeEvent[]) {
  return events
    .filter((e) => e.type === "draft.pick")
    .map((e) => e.payload as { pickNumber: number; teamId: string; playerId: string; price: number | null });
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
  control.disconnect();
  publisher.close();
});

describe("two SSE clients watching a live snake draft", () => {
  it("both see every pick, in the same order, and can reconstruct the server's final state", async () => {
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_sse_snake", leagueId: "league_sse_snake", format: "snake", teamCount: 12,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await insertPlayers(60);
    await control.del(REALTIME_CONFIG.leagueStreamKey(fixture.leagueId));

    const draft = store();
    const ac = new AbortController();
    const watchers: Watcher[] = [{ ready: false }, { ready: false }];
    const clients = watchers.map((watcher) => watchUntilComplete(fixture.leagueId, ac.signal, watcher));
    await waitUntilSubscribersReady(fixture.leagueId, watchers);

    const started = await draft.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);

    let state: DraftState = started.state;
    while (state.phase !== "complete") {
      const teamId = teamOnClock(state);
      if (teamId === null) throw new Error("nobody on the clock mid-draft");
      const best = bestAvailableFor(state, teamId);
      if (best === null) throw new Error("no draftable player left");
      const result = await draft.applyAction(fixture.draftId, {
        v: 1, type: "MAKE_PICK", timestamp: clock.now(), teamId, playerId: best.playerId,
      });
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }

    const [first, second] = await Promise.all(clients);
    ac.abort();

    // 12 teams x 3 roster spots.
    expect(state.picks).toHaveLength(36);
    // Broadcast, not partitioned: both clients saw the identical stream (this is what
    // XREADGROUP would have broken).
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
    expect(picksFromEvents(first)).toHaveLength(36);
    // Each client can rebuild the server's pick list from what it received.
    for (const client of [first, second]) {
      expect(picksFromEvents(client).map((p) => [p.pickNumber, p.teamId, p.playerId])).toEqual(
        state.picks.map((p) => [p.pickNumber, p.teamId, p.playerId]),
      );
    }
    expect(first[0]?.type).toBe("draft.status");
    expect(first.at(-1)?.type).toBe("draft.status");
  }, 60_000);
});

describe("two SSE clients watching a live auction draft", () => {
  it("both see every nomination, bid and award with the winning price", async () => {
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_sse_auction", leagueId: "league_sse_auction", format: "auction", teamCount: 4,
      slotConfig: AUCTION_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: 50,
    });
    await insertPlayers(30);
    await control.del(REALTIME_CONFIG.leagueStreamKey(fixture.leagueId));

    const draft = store();
    const ac = new AbortController();
    const watchers: Watcher[] = [{ ready: false }, { ready: false }];
    const clients = watchers.map((watcher) => watchUntilComplete(fixture.leagueId, ac.signal, watcher));
    await waitUntilSubscribersReady(fixture.leagueId, watchers);

    const started = await draft.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);

    let state: DraftState = started.state;
    const act = async (action: Parameters<typeof draft.applyAction>[1]) => {
      const result = await draft.applyAction(fixture.draftId, action);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    };

    while (state.phase !== "complete") {
      const nominator = state.auction?.nominatingTeamId;
      if (nominator === undefined || nominator === null) throw new Error("nobody up to nominate");
      const best = bestAvailableFor(state, nominator);
      if (best === null) throw new Error("no draftable player left");
      await act({ v: 1, type: "NOMINATE", timestamp: clock.now(), teamId: nominator, playerId: best.playerId, openingBid: 1 });

      // Let one rival contest the lot. Whether a given team can legally roster this player
      // depends on its roster, so try each in turn and keep the first bid that lands.
      for (const teamId of state.draftOrder) {
        if (teamId === nominator) continue;
        const attempt = await draft.applyAction(fixture.draftId, { v: 1, type: "BID", timestamp: clock.now(), teamId, amount: 2 });
        if (attempt.ok) {
          state = attempt.state;
          break;
        }
      }
      // The reducer rejects a TIMER_EXPIRE whose timestamp is earlier than the deadline it
      // actually set (Ruling R-B4) — a lot is open here, so that's the 15s live bid window,
      // not the multi-hour pick-clock tier. The fixed test clock never advances on its own,
      // so the expiry timestamp must be derived from the state, not from `clock.now()`.
      await act({ v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(state) ?? clock.now() });
    }

    const [first, second] = await Promise.all(clients);
    ac.abort();

    // 4 teams x 2 roster spots.
    expect(state.picks).toHaveLength(8);
    expect(first.map((e) => e.id)).toEqual(second.map((e) => e.id));
    for (const client of [first, second]) {
      expect(client.filter((e) => e.type === "draft.nominate")).toHaveLength(8);
      expect(client.filter((e) => e.type === "draft.bid").length).toBeGreaterThan(0);
      expect(picksFromEvents(client).map((p) => [p.playerId, p.price])).toEqual(
        state.picks.map((p) => [p.playerId, p.price]),
      );
    }
  }, 60_000);
});

/** A generic reader for any stream key — the league one or a user's own — until aborted. */
async function readFrames(streamKey: string, signal: AbortSignal, watcher: Watcher): Promise<RealtimeEvent[]> {
  const seen: RealtimeEvent[] = [];
  const redis = new Redis(REDIS_URL);
  try {
    for await (const event of subscribe({ redis, streamKey, afterId: "$", signal })) {
      watcher.ready = true;
      seen.push(event);
    }
  } finally {
    redis.disconnect();
  }
  return seen;
}

/** Same deterministic-readiness idea as `waitUntilSubscribersReady`, generalized to any key. */
async function waitUntilFramesReady(
  probes: readonly { readonly watcher: Watcher; readonly send: () => Promise<unknown> }[],
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (probes.some(({ watcher }) => !watcher.ready)) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for stream subscribers to register.");
    await Promise.all(probes.map(({ send }) => send()));
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("an autopicked notice, watched by two SSE clients — the manager's own and the league's", () => {
  it("reaches only the picked-for manager's own stream, with no copy, and never the league's", async () => {
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_sse_notice", leagueId: "league_sse_notice", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    await insertPlayers(6);
    await control.del(REALTIME_CONFIG.leagueStreamKey(fixture.leagueId));

    const draft = store();
    const started = await draft.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);
    const onClock = teamOnClock(started.state);
    if (onClock === null) throw new Error("nobody on the clock");
    const pickedForUserId = fixture.userIds[fixture.teamIds.indexOf(onClock)]!;
    const leaguemateUserId = fixture.userIds.find((id) => id !== pickedForUserId)!;
    await control.del(REALTIME_CONFIG.userStreamKey(pickedForUserId), REALTIME_CONFIG.userStreamKey(leaguemateUserId));

    const ac = new AbortController();
    const leagueWatcher: Watcher = { ready: false };
    const mineWatcher: Watcher = { ready: false };
    const leaguemateWatcher: Watcher = { ready: false };
    const leagueFrames = readFrames(REALTIME_CONFIG.leagueStreamKey(fixture.leagueId), ac.signal, leagueWatcher);
    const mineFrames = readFrames(REALTIME_CONFIG.userStreamKey(pickedForUserId), ac.signal, mineWatcher);
    const leaguemateFrames = readFrames(REALTIME_CONFIG.userStreamKey(leaguemateUserId), ac.signal, leaguemateWatcher);

    await waitUntilFramesReady([
      { watcher: leagueWatcher, send: () => publisher.publish({ leagueId: fixture.leagueId, type: "chat.message", payload: { probe: true } }) },
      { watcher: mineWatcher, send: () => publisher.publishToUser({ userId: pickedForUserId, leagueId: fixture.leagueId, type: "chat.message", payload: { probe: true } }) },
      { watcher: leaguemateWatcher, send: () => publisher.publishToUser({ userId: leaguemateUserId, leagueId: fixture.leagueId, type: "chat.message", payload: { probe: true } }) },
    ]);

    // Queued (Task 5): this fixture's kickoff sits 9+ days out, a slow tier, where a queueless
    // team is now skip-eligible rather than autopicked — this test is about the autopick path.
    const queued = await draft.applyAction(fixture.draftId, {
      v: 1, type: "SET_QUEUE", timestamp: clock.now(), teamId: onClock, playerIds: ["p001"],
    });
    if (!queued.ok) throw new Error(queued.reason);

    // The ticker's own mechanism: the clock ran out, so this autopicks for whoever is on it.
    const result = await draft.applyAction(fixture.draftId, {
      v: 1, type: "TIMER_EXPIRE", timestamp: currentDeadline(queued.state) ?? clock.now(),
    });
    if (!result.ok) throw new Error(result.reason);

    // Give the pick's public frame and the notice's private frame both a moment to arrive.
    await new Promise((resolve) => setTimeout(resolve, 300));
    ac.abort();
    const [leagueSeen, mineSeen, leaguemateSeen] = await Promise.all([leagueFrames, mineFrames, leaguemateFrames]);

    const real = (frames: readonly RealtimeEvent[]) => frames.filter((e) => (e.payload as { probe?: boolean } | null)?.probe !== true);

    // The pick is public — the league sees it.
    expect(real(leagueSeen).some((e) => e.type === "draft.pick")).toBe(true);
    // The notice is not — it never rides the league broadcast, ruling 13's guard.
    expect(real(leagueSeen).some((e) => e.type === "notice.created")).toBe(false);

    // Only the picked-for manager's own stream carries it, content-free.
    const notice = real(mineSeen).find((e) => e.type === "notice.created");
    expect(notice).toBeDefined();
    expect(Object.keys(notice!.payload as object).sort()).toEqual(["noticeId", "noticeType"]);
    expect((notice!.payload as { noticeType: string }).noticeType).toBe("draft_auto_picked");

    // A leaguemate's own stream never sees it either — this is per-user, not per-league.
    expect(real(leaguemateSeen).some((e) => e.type === "notice.created")).toBe(false);
  }, 15_000);
});
