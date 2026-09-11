import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "@/db/client";
import Redis from "ioredis";
import { chatMessages, leagues, teams, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { CHAT_CONFIG } from "@/chat/config";
import type { AuditEventInput } from "@/domain/audit";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { EventReactionBody } from "@/league-room/contract";
import { reactionsForEvents } from "./event-reactions";

const db: Db = createTestDb();
const currentUser = vi.fn<() => Promise<{ readonly id: string } | null>>();

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: () => db };
});
vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: () => currentUser(),
  requireCurrentUser: async () => {
    const user = await currentUser();
    if (user === null) throw new Error("not signed in");
    return user;
  },
}));

const { POST } = await import("@/app/api/leagues/[leagueId]/activity/[eventId]/reactions/route");
const { POST: REACT_TO_MESSAGE } = await import("@/app/api/leagues/[leagueId]/chat/[messageId]/reactions/route");
const { reactionRateLimited, resetReactionRateLimitFor } = await import("@/app/api/leagues/_reaction-limit");

const url = "http://localhost/api/leagues/l1/activity/evt_1/reactions";

function contextFor(eventId: string, leagueId = "l1") {
  return { params: Promise.resolve({ leagueId, eventId }) };
}

function react(emoji: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ emoji }) });
}

/** The message route's own context and body, so one test can spend from both doors. */
function messageContextFor(messageId: string) {
  return { params: Promise.resolve({ leagueId: "l1", messageId }) };
}

function reactToMessage(emoji: string): Request {
  return new Request(`http://localhost/api/leagues/l1/chat/1/reactions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ emoji }),
  });
}

let minted = 0;
const logger = createAuditLogger({ newId: () => `evt_${(minted += 1)}` });

function pickInput(leagueId: string, teamId: string): AuditEventInput {
  return {
    eventType: "draft_pick",
    actorId: "u1",
    actorType: "user",
    leagueId,
    payload: { draftId: "d", teamId, playerId: "p1", position: "RB", round: 1, pickNumber: 1, slot: "RB", slotIndex: 0, price: null, auto: false },
    occurredAt: "2026-09-10T17:00:00.000Z",
  };
}

beforeEach(async () => {
  await truncateAll(db);
  minted = 0;
  await resetReactionRateLimitFor("u1");
  await resetReactionRateLimitFor("u_stranger");
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Rey" },
    { id: "u_stranger", email: "s@test.local", displayName: "Nobody" },
  ]);
  await db.insert(leagues).values([
    { id: "l1", name: "L1", format: "snake", teamCount: 2, commissionerUserId: "u1" },
    // A SECOND REAL LEAGUE the caller is also a member of, so the cross-league refusal is about
    // the EVENT's own scope rather than about membership refusing first (M4).
    { id: "l2", name: "L2", format: "snake", teamCount: 2, commissionerUserId: "u1" },
  ]);
  await db.insert(teams).values([
    { id: "t1", leagueId: "l1", userId: "u1", name: "Trap Game" },
    { id: "t2", leagueId: "l2", userId: "u1", name: "Bye Week" },
  ]);
  // `evt_1` belongs to l1, `evt_2` to l2 — both real, both this caller's own leagues.
  await db.transaction((tx) => logger.record(tx, pickInput("l1", "t1")));
  await db.transaction((tx) => logger.record(tx, pickInput("l2", "t2")));
  currentUser.mockResolvedValue({ id: "u1" });
});

describe("POST /api/leagues/[leagueId]/activity/[eventId]/reactions", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    currentUser.mockResolvedValue(null);
    const response = await POST(react("🔥"), contextFor("evt_1"));
    expect(response.status).toBe(401);
  });

  it("answers 403 for a signed-in stranger with no seat here", async () => {
    currentUser.mockResolvedValue({ id: "u_stranger" });
    const response = await POST(react("🔥"), contextFor("evt_1"));
    expect(response.status).toBe(403);
  });

  it("toggles the caller's own reaction and says what it did", async () => {
    const added = (await (await POST(react("🔥"), contextFor("evt_1"))).json()) as ApiEnvelope<EventReactionBody>;
    expect(added).toEqual({ ok: true, data: { eventId: "evt_1", action: "added" } });

    const held = await reactionsForEvents(db, "l1", ["evt_1"]);
    expect(held.get("evt_1")).toEqual([{ emoji: "🔥", userId: "u1" }]);

    const removed = (await (await POST(react("🔥"), contextFor("evt_1"))).json()) as ApiEnvelope<EventReactionBody>;
    expect(removed).toEqual({ ok: true, data: { eventId: "evt_1", action: "removed" } });
  });

  it("refuses an emoji outside the league's own set", async () => {
    const response = await POST(react("🍕"), contextFor("evt_1"));
    expect(response.status).toBe(400);
  });

  it("refuses a malformed event id before it reaches the database", async () => {
    const response = await POST(react("🔥"), contextFor("drop table audit_events"));
    expect(response.status).toBe(400);
    expect(((await response.json()) as ApiEnvelope<never>).ok).toBe(false);
  });

  it("answers 404 for an event id that names nothing at all", async () => {
    const response = await POST(react("🔥"), contextFor("evt_missing"));
    expect(response.status).toBe(404);
  });

  /**
   * M4: the property that matters is not "an id that exists nowhere is refused" — it is that a
   * REAL event, one this very caller may read through its own league, cannot be reached by naming
   * a different league in the path. The caller is a member of both, so membership refuses nothing
   * here and the event's own scope is the only thing standing.
   */
  it("answers 404 for a real event owned by another league, even one the caller belongs to", async () => {
    // The same event through its own league is fine, so the refusal below is about the scope.
    expect((await POST(react("🔥"), contextFor("evt_2", "l2"))).status).toBe(200);

    const borrowed = await POST(react("🔥"), contextFor("evt_2", "l1"));
    expect(borrowed.status).toBe(404);
    // And nothing was written under the borrowed scope.
    expect((await reactionsForEvents(db, "l1", ["evt_2"])).size).toBe(0);
  });

  it("answers 429 once one caller passes the shared reaction ceiling", async () => {
    for (let n = 0; n < CHAT_CONFIG.reactionRateLimit.maxRequests; n += 1) {
      const response = await POST(react("🔥"), contextFor("evt_1"));
      expect(response.status).toBe(200);
    }
    const response = await POST(react("🔥"), contextFor("evt_1"));
    expect(response.status).toBe(429);
  });
});

/**
 * M2: the ceiling is ONE budget in Redis, not one counter per handler bundle. Spend most of it on
 * the stream route and the rest on the message route, and the next request through EITHER door is
 * refused — which is the whole "no detour" property, asserted where it can actually fail.
 */
describe("the reaction ceiling both routes draw down", () => {
  it("is one budget: the stream route's spending closes the message route too", async () => {
    await db.insert(chatMessages).values({ leagueId: "l1", authorUserId: "u1", body: "who is starting that kicker" });

    const half = Math.floor(CHAT_CONFIG.reactionRateLimit.maxRequests / 2);
    for (let n = 0; n < half; n += 1) {
      expect((await POST(react("🔥"), contextFor("evt_1"))).status).toBe(200);
    }
    for (let n = half; n < CHAT_CONFIG.reactionRateLimit.maxRequests; n += 1) {
      expect((await REACT_TO_MESSAGE(reactToMessage("👏"), messageContextFor("1"))).status).toBe(200);
    }

    // The budget is spent. Both doors are shut, and neither is a way round the other.
    expect((await REACT_TO_MESSAGE(reactToMessage("👏"), messageContextFor("1"))).status).toBe(429);
    expect((await POST(react("🔥"), contextFor("evt_1"))).status).toBe(429);
  });

  it("fails CLOSED when the ledger cannot be reached, never open", async () => {
    const dead = new Redis("redis://localhost:1", { maxRetriesPerRequest: 0, lazyConnect: true, enableOfflineQueue: false });
    try {
      const refusal = await reactionRateLimited("u1", dead);
      expect(refusal?.status).toBe(503);
      expect(((await refusal!.json()) as ApiEnvelope<never>).ok).toBe(false);
    } finally {
      dead.disconnect();
    }
  });
});
