import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Db } from "@/db/client";
import { leagues, teams, users } from "@/db/schema";
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
const { resetReactionRateLimit } = await import("@/app/api/leagues/_reaction-limit");

const url = "http://localhost/api/leagues/l1/activity/evt_1/reactions";

function contextFor(eventId: string) {
  return { params: Promise.resolve({ leagueId: "l1", eventId }) };
}

function react(emoji: unknown): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ emoji }) });
}

let minted = 0;
const logger = createAuditLogger({ newId: () => `evt_${(minted += 1)}` });

function pickInput(): AuditEventInput {
  return {
    eventType: "draft_pick",
    actorId: "u1",
    actorType: "user",
    leagueId: "l1",
    payload: { draftId: "d", teamId: "t1", playerId: "p1", position: "RB", round: 1, pickNumber: 1, slot: "RB", slotIndex: 0, price: null, auto: false },
    occurredAt: "2026-09-10T17:00:00.000Z",
  };
}

beforeEach(async () => {
  await truncateAll(db);
  minted = 0;
  resetReactionRateLimit();
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Rey" },
    { id: "u_stranger", email: "s@test.local", displayName: "Nobody" },
  ]);
  await db.insert(leagues).values({ id: "l1", name: "L1", format: "snake", teamCount: 2, commissionerUserId: "u1" });
  await db.insert(teams).values({ id: "t1", leagueId: "l1", userId: "u1", name: "Trap Game" });
  await db.transaction((tx) => logger.record(tx, pickInput()));
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

  it("answers 404 for an event this league does not own", async () => {
    const response = await POST(react("🔥"), contextFor("evt_missing"));
    expect(response.status).toBe(404);
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
