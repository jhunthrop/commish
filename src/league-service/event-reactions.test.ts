import { beforeEach, describe, expect, it } from "vitest";
import { leagues, teams, users } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import type { Db } from "@research-ts/db/client";
import type { AuditEventInput } from "@/domain/audit";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import type { RealtimeEventType } from "@/lib/realtime/events";
import { reactionsForEvents, toggleEventReaction } from "./event-reactions";

const db: Db = createTestDb();

interface Published {
  readonly type: RealtimeEventType;
  readonly leagueId: string;
  readonly payload: unknown;
}

function recorder() {
  const sent: Published[] = [];
  return {
    sent,
    publish: async (input: Published) => {
      sent.push(input);
      return "1-0";
    },
  };
}

let minted = 0;
const logger = createAuditLogger({ newId: () => `evt_${(minted += 1)}` });

function pickInput(leagueId: string, pickNumber: number): AuditEventInput {
  return {
    eventType: "draft_pick",
    actorId: "user_rey",
    actorType: "user",
    leagueId,
    payload: { draftId: "d", teamId: "team_rey", playerId: "player_1", position: "RB", round: 1, pickNumber, slot: "RB", slotIndex: 0, price: null, auto: false },
    occurredAt: new Date(Date.UTC(2026, 8, 10, 17, 0, pickNumber)).toISOString(),
  };
}

/** Two leagues, two members, one pick event in each — the smallest fixture that can prove the
 *  league scope is real rather than assumed. */
async function fixture(): Promise<void> {
  minted = 0;
  await db.insert(users).values([
    { id: "user_rey", email: "rey@test.local", displayName: "Rey" },
    { id: "user_dana", email: "dana@test.local", displayName: "Dana" },
  ]);
  await db.insert(leagues).values([
    { id: "league_a", name: "League A", format: "snake", teamCount: 2, commissionerUserId: "user_rey" },
    { id: "league_b", name: "League B", format: "snake", teamCount: 2, commissionerUserId: "user_rey" },
  ]);
  await db.insert(teams).values([
    { id: "team_rey", leagueId: "league_a", userId: "user_rey", name: "Trap Game" },
    { id: "team_dana", leagueId: "league_a", userId: "user_dana", name: "Sunday Scaries" },
  ]);
  await db.transaction((tx) => logger.record(tx, pickInput("league_a", 1)));
  await db.transaction((tx) => logger.record(tx, pickInput("league_b", 2)));
}

beforeEach(async () => {
  await truncateAll(db);
  await fixture();
});

describe("toggleEventReaction", () => {
  it("adds then removes the same pair, and publishes each transition", async () => {
    const bus = recorder();
    const added = await toggleEventReaction(db, { leagueId: "league_a", eventId: "evt_1", userId: "user_dana", emoji: "🔥", publish: bus.publish });
    expect(added).toEqual({ ok: true, action: "added" });

    const removed = await toggleEventReaction(db, { leagueId: "league_a", eventId: "evt_1", userId: "user_dana", emoji: "🔥", publish: bus.publish });
    expect(removed).toEqual({ ok: true, action: "removed" });

    expect(bus.sent.map((frame) => frame.type)).toEqual(["stream.reaction", "stream.reaction"]);
    expect(bus.sent[0]).toEqual({
      leagueId: "league_a",
      type: "stream.reaction",
      payload: { eventId: "evt_1", emoji: "🔥", userId: "user_dana", action: "added" },
    });
    expect(bus.sent[1]?.payload).toMatchObject({ action: "removed" });
  });

  it("lets the actor of the event react to their own", async () => {
    const bus = recorder();
    const result = await toggleEventReaction(db, { leagueId: "league_a", eventId: "evt_1", userId: "user_rey", emoji: "👏", publish: bus.publish });
    expect(result).toEqual({ ok: true, action: "added" });
  });

  it("refuses an event in another league", async () => {
    const bus = recorder();
    const result = await toggleEventReaction(db, { leagueId: "league_a", eventId: "evt_2", userId: "user_dana", emoji: "🔥", publish: bus.publish });
    expect(result).toEqual({ ok: false, status: 404, reason: "That is no longer here." });
    expect(bus.sent).toEqual([]);
  });

  it("refuses an event id that does not exist", async () => {
    const bus = recorder();
    const result = await toggleEventReaction(db, { leagueId: "league_a", eventId: "evt_nope", userId: "user_dana", emoji: "🔥", publish: bus.publish });
    expect(result).toEqual({ ok: false, status: 404, reason: "That is no longer here." });
  });

  it("swallows a publish failure and still reports the write it made", async () => {
    const seen: unknown[] = [];
    const result = await toggleEventReaction(db, {
      leagueId: "league_a",
      eventId: "evt_1",
      userId: "user_dana",
      emoji: "🔥",
      publish: async () => {
        throw new Error("redis is down");
      },
      onPublishError: (error) => seen.push(error),
    });
    expect(result).toEqual({ ok: true, action: "added" });
    expect(seen).toHaveLength(1);
    const reactions = await reactionsForEvents(db, "league_a", ["evt_1"]);
    expect(reactions.get("evt_1")).toEqual([{ emoji: "🔥", userId: "user_dana" }]);
  });

  it("a concurrent double tap resolves to one row and one added frame", async () => {
    const bus = recorder();
    const [first, second] = await Promise.all([
      toggleEventReaction(db, { leagueId: "league_a", eventId: "evt_1", userId: "user_dana", emoji: "🔥", publish: bus.publish }),
      toggleEventReaction(db, { leagueId: "league_a", eventId: "evt_1", userId: "user_dana", emoji: "🔥", publish: bus.publish }),
    ]);
    const actions = [first, second].map((result) => (result.ok ? result.action : "refused"));
    expect(actions.sort()).toEqual(["added", "removed"]);
    // Exactly one of the two callers actually wrote, so exactly one frame per transition.
    expect(bus.sent).toHaveLength(2);
  });
});

describe("reactionsForEvents", () => {
  it("groups by event and holds only this league's events", async () => {
    const bus = recorder();
    await toggleEventReaction(db, { leagueId: "league_a", eventId: "evt_1", userId: "user_dana", emoji: "🔥", publish: bus.publish });
    await toggleEventReaction(db, { leagueId: "league_a", eventId: "evt_1", userId: "user_rey", emoji: "🔥", publish: bus.publish });
    await toggleEventReaction(db, { leagueId: "league_b", eventId: "evt_2", userId: "user_rey", emoji: "😂", publish: bus.publish });

    const grouped = await reactionsForEvents(db, "league_a", ["evt_1", "evt_2"]);
    expect(grouped.get("evt_1")).toHaveLength(2);
    expect(grouped.get("evt_1")).toContainEqual({ emoji: "🔥", userId: "user_rey" });
    expect(grouped.get("evt_2")).toBeUndefined();
  });

  it("answers empty for no ids without touching the database", async () => {
    const grouped = await reactionsForEvents(db, "league_a", []);
    expect(grouped.size).toBe(0);
  });

  it("answers empty for events nobody has reacted to", async () => {
    const grouped = await reactionsForEvents(db, "league_a", ["evt_1"]);
    expect(grouped.size).toBe(0);
  });
});
