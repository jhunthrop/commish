import { describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES, type AuditEvent, type AuditEventType, type JsonObject } from "@/domain/audit";
import { ACTIVITY_VISIBILITY, activityRowFor } from "./activity-view";

const names = {
  member: (id: string | null) => (id === "user_alice" ? "Alice" : id === "user_bob" ? "Bob" : "A former member"),
  player: (id: string) => (id === "player_1" ? "Bijan Robinson" : "A player who is no longer listed"),
  team: (id: string) => (id === "team_1" ? "Alice's team" : "Another team"),
};
const viewer = { userId: "user_bob" };

/** One row of `AuditEvent`, with a fixed id/scope/hash chain so every test only has to vary the
 *  fields it actually cares about: `eventType`, `payload` and `actorId`. */
function event(eventType: AuditEventType, payload: JsonObject, actorId: string | null): AuditEvent {
  return {
    eventId: "evt_1",
    chainScope: "league_1",
    sequence: 1,
    eventType,
    actorId,
    actorType: actorId === null ? "system" : "user",
    leagueId: "league_1",
    payload,
    occurredAt: "2026-08-20T17:00:00.000Z",
    previousEventHash: "genesis",
    eventHash: "hash1",
    hashVersion: 1,
  };
}

const pickPayload: JsonObject = {
  draftId: "d",
  teamId: "team_1",
  playerId: "player_1",
  position: "RB",
  round: 2,
  pickNumber: 24,
  slot: "RB",
  slotIndex: 0,
  price: null,
  auto: false,
};

/** One renderable sample per type this plan publishes, INCLUDING both `draft_pick` shapes (human
 *  and clock-made) — the em-dash sweep runs over every sentence this module can actually produce. */
const EVERY_RENDERABLE_SAMPLE: readonly AuditEvent[] = [
  event(
    "league_created",
    { name: "Sunday Money", format: "redraft", teamCount: 10, stakeTier: "money", isPublicMatchmade: false, experienceTier: "beginner", scoringPreset: "standard" },
    "user_alice",
  ),
  event("member_joined", { teamId: "team_1", via: "invite" }, "user_bob"),
  event("draft_pick", pickPayload, "user_alice"),
  event("draft_pick", { ...pickPayload, auto: true }, null),
  event("draft_completed", { draftId: "d", picks: 120, teams: 10 }, null),
  event("lineup_change", { teamId: "team_2", weekNumber: 3, starters: [] }, "user_bob"),
  event("system_action", { action: "lineup_auto_set", summary: "Bob's week 4 lineup was set automatically." }, null),
];

describe("ACTIVITY_VISIBILITY", () => {
  it("decides every event type in the vocabulary", () => {
    expect(Object.keys(ACTIVITY_VISIBILITY).sort()).toEqual([...AUDIT_EVENT_TYPES].sort());
  });

  it("hides every type this plan does not publish, so a later plan has to decide on purpose", () => {
    for (const type of ["trade_proposed", "trade_accepted", "trade_rejected", "roster_move", "flag_raised", "flag_resolved", "admin_action"] as const) {
      expect(ACTIVITY_VISIBILITY[type]).toBe("hidden");
    }
  });

  it("hides the platform chain's types, which can never appear in a league feed anyway", () => {
    for (const type of ["session_started", "profile_updated", "review_removed"] as const) {
      expect(ACTIVITY_VISIBILITY[type]).toBe("hidden");
    }
  });
});

describe("activityRowFor", () => {
  it("renders a human pick with the round and the pick number", () => {
    expect(activityRowFor(event("draft_pick", { ...pickPayload }, "user_alice"), viewer, names)).toEqual({
      eventId: "evt_1",
      occurredAt: "2026-08-20T17:00:00.000Z",
      icon: "check",
      headline: "Alice drafted Bijan Robinson.",
      detail: "Round 2, pick 24.",
    });
  });

  it("says the clock did it when the clock did it, and never blames the manager", () => {
    const row = activityRowFor(event("draft_pick", { ...pickPayload, auto: true }, null), viewer, names);
    expect(row).toMatchObject({
      icon: "clock",
      headline: "The clock ran out, so Alice's team drafted Bijan Robinson from their queue.",
    });
  });

  it("shows an auction price only when there is one", () => {
    expect(activityRowFor(event("draft_pick", { ...pickPayload, price: 42 }, "user_alice"), viewer, names)?.detail).toBe("Round 2, pick 24. Won for $42.");
  });

  it("shows a member their own lineup change and nobody else's", () => {
    const mine = event("lineup_change", { teamId: "team_2", weekNumber: 3, starters: [] }, "user_bob");
    const theirs = event("lineup_change", { teamId: "team_1", weekNumber: 3, starters: [] }, "user_alice");
    expect(activityRowFor(mine, viewer, names)?.headline).toBe("You set your week 3 lineup.");
    expect(activityRowFor(theirs, viewer, names)).toBeNull();
  });

  it("returns null for a hidden type rather than a row with a blank headline", () => {
    expect(activityRowFor(event("flag_raised", { flagId: "f1" }, null), viewer, names)).toBeNull();
  });

  it("returns null for a payload missing a field it needs", () => {
    // A malformed payload renders NOTHING. The alternative is a feed row that says "undefined
    // drafted undefined", which is worse than a missing row in every way.
    expect(activityRowFor(event("draft_pick", { teamId: "team_1" }, "user_alice"), viewer, names)).toBeNull();
  });

  it("never lets a payload field it did not ask for reach the row", () => {
    // The allowlist proof, in this module rather than only across Plan B's two views: an extra
    // field on the payload (a similarity score, a private note) cannot appear in the output.
    const row = activityRowFor(event("member_joined", { teamId: "team_1", via: "invite", internalRiskScore: 0.97 }, "user_bob"), viewer, names);
    expect(JSON.stringify(row)).not.toContain("0.97");
    expect(JSON.stringify(row)).not.toContain("internalRiskScore");
  });

  it("renders a system action from its own summary, which is the contract Plan D writes against", () => {
    expect(activityRowFor(event("system_action", { action: "lineup_auto_set", summary: "Bob's week 4 lineup was set automatically." }, null), viewer, names)).toMatchObject({
      icon: "alert-triangle",
      headline: "Bob's week 4 lineup was set automatically.",
    });
    // No summary, no row. A system action that cannot explain itself does not get a feed entry.
    expect(activityRowFor(event("system_action", { action: "lineup_auto_set" }, null), viewer, names)).toBeNull();
  });

  it("uses no em-dash in any headline or detail it can produce", () => {
    for (const sample of EVERY_RENDERABLE_SAMPLE) {
      const row = activityRowFor(sample, viewer, names);
      expect(`${row?.headline ?? ""} ${row?.detail ?? ""}`).not.toMatch(/[—–]/);
    }
  });
});
