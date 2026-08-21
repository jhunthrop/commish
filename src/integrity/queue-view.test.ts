import { describe, expect, it } from "vitest";
import type { AuditEvent, AuditEventType, JsonObject } from "@/domain/audit";
import { ACTIVITY_VISIBILITY, activityRowFor } from "./activity-view";
import { flagDetailFor, flagTrailRowFor, formatFlagCursor, parseFlagCursor, queueRowFor, type FlagSubjectView } from "./queue-view";

const names = {
  member: (id: string | null) => (id === "u_reporter" ? "Reporter" : "A former member"),
  player: () => "A player who is no longer listed",
  team: () => "Another team",
};

/** One row of `AuditEvent`, with a fixed id/hash chain so every test only has to vary the fields
 *  it actually cares about — the same fixture shape `activity-view.test.ts` uses. */
function event(eventType: AuditEventType, payload: JsonObject, chainScope = "platform"): AuditEvent {
  return {
    eventId: "evt_1",
    chainScope,
    sequence: 1,
    eventType,
    actorId: "u_reporter",
    actorType: "user",
    leagueId: null,
    payload,
    occurredAt: "2026-08-20T17:00:00.000Z",
    previousEventHash: "genesis",
    eventHash: "hash1",
    hashVersion: 1,
  };
}

function flagRaisedEvent(overrides: Partial<{ readonly evidence: JsonObject }> = {}): AuditEvent {
  return event("flag_raised", { flagId: "flag_1", flagType: "multi_account", subjectType: "account_pair", leagueId: "league_1", ...overrides });
}

const flag = { id: "flag_1", flagType: "review_report" as const, raisedAt: "2026-08-01T00:00:00.000Z", leagueId: null, evidence: { device: 0.94, behavioral: 0.81 }, resolution: null };
const subject: FlagSubjectView = { kind: "review", reviewId: "r1", body: "Great season overall.", authorName: "Ada", removedAt: null };

describe("queueRowFor", () => {
  it("never carries evidence, and names what kind of question this is in plain words", () => {
    const row = queueRowFor({ flagId: "flag_1", flagType: "review_report", raisedAt: "2026-08-01T00:00:00.000Z", about: "A review by Ada" });
    expect(row).toEqual({
      flagId: "flag_1",
      icon: "alert-triangle",
      question: "A member reported a review",
      about: "A review by Ada",
      raisedAt: "2026-08-01T00:00:00.000Z",
    });
    expect(row).not.toHaveProperty("evidence");
  });

  it("has a question and an icon for every flag type — exhaustive by construction", () => {
    for (const flagType of ["multi_account", "review_report", "chat_report", "trade_fairness"] as const) {
      const row = queueRowFor({ flagId: "f", flagType, raisedAt: "2026-08-01T00:00:00.000Z", about: "Someone" });
      expect(row.question.length).toBeGreaterThan(0);
      expect(row.icon).toBeTruthy();
    }
  });
});

describe("flagDetailFor — the operator's field set, proved against the member's", () => {
  it("puts the raw similarity scores in the operator's view and nowhere a member can reach", () => {
    expect(flagDetailFor(flag, subject, [], []).evidence).toMatchObject({ device: 0.94, behavioral: 0.81 });

    // The member side of the same claim, run against Plan A's module rather than restated: no
    // path exists from an audit event to a member-facing row that could carry `evidence`.
    const raised = flagRaisedEvent({ evidence: { device: 0.94, behavioral: 0.81 } });
    expect(activityRowFor(raised, { userId: "u_member" }, names)).toBeNull();
    expect(ACTIVITY_VISIBILITY.flag_raised).toBe("hidden");
  });

  it("offers an operator no decision this product cannot carry out", () => {
    expect(flagDetailFor(flag, subject, [], []).decisions).not.toContain("trade_reversed");
    expect(flagDetailFor(flag, subject, [], []).decisions).toEqual(["no_action", "warned_user", "content_removed"]);
  });

  it("offers no decision at all once a flag is already resolved — a second attempt is a new flag, not an edit", () => {
    const resolved = { ...flag, resolution: { decision: "no_action" as const, note: "n", resolvedAt: "2026-08-02T00:00:00.000Z", resolvedByUserId: "u_op", resolvedByName: "Op" } };
    const detail = flagDetailFor(resolved, subject, [], []);
    expect(detail.decisions).toEqual([]);
    expect(detail.resolution).toEqual(resolved.resolution);
  });

  it("carries the subject, reporters and trail straight through — this module renders, it does not fetch", () => {
    const reporters = [{ userId: "u_reporter", name: "Reporter", reason: "spam", reportedAt: "2026-08-01T00:00:00.000Z" }];
    const trail = [{ eventId: "evt_1", occurredAt: "2026-08-01T00:00:00.000Z", icon: "alert-triangle" as const, headline: "This flag was opened.", detail: null }];
    const detail = flagDetailFor(flag, subject, reporters, trail);
    expect(detail.subject).toBe(subject);
    expect(detail.reporters).toBe(reporters);
    expect(detail.trail).toBe(trail);
    expect(detail.flagId).toBe("flag_1");
    expect(detail.raisedAt).toBe("2026-08-01T00:00:00.000Z");
  });
});

describe("flagTrailRowFor", () => {
  it("renders a flag being opened", () => {
    const row = flagTrailRowFor(flagRaisedEvent());
    expect(row).toMatchObject({ headline: "This flag was opened.", icon: "alert-triangle" });
  });

  it("renders each resolution decision in its own words, and an unrecognized one honestly", () => {
    const warned = flagTrailRowFor(event("flag_resolved", { flagId: "flag_1", decision: "warned_user" }));
    expect(warned?.headline).toBe("An operator sent the member a warning.");

    const removed = flagTrailRowFor(event("flag_resolved", { flagId: "flag_1", decision: "content_removed" }));
    expect(removed?.headline).toBe("An operator removed the reported content.");

    const noAction = flagTrailRowFor(event("flag_resolved", { flagId: "flag_1", decision: "no_action" }));
    expect(noAction?.headline).toBe("An operator closed this flag with no action.");

    const malformed = flagTrailRowFor(event("flag_resolved", { flagId: "flag_1", decision: "not_a_real_decision" }));
    expect(malformed?.headline).toBe("An operator resolved this flag.");

    // A row missing `decision` entirely (a malformed or pre-migration payload) reads the same
    // honest fallback as an unrecognized string — `payloadStr`'s own `undefined` branch.
    const missing = flagTrailRowFor(event("flag_resolved", { flagId: "flag_1" }));
    expect(missing?.headline).toBe("An operator resolved this flag.");
  });

  it("renders a review's removal", () => {
    const row = flagTrailRowFor(event("review_removed", { reviewId: "r1", authorUserId: "u1", reason: "x", flagId: "flag_1" }));
    expect(row?.headline).toBe("The reported review was removed.");
  });

  it("renders a member joining, for account-pair trails read off the league chain", () => {
    const row = flagTrailRowFor(event("member_joined", {}, "league_1"));
    expect(row?.headline).toBe("This account joined the league.");
  });

  it("denies everything else, deny-by-default", () => {
    expect(flagTrailRowFor(event("admin_action", { action: "admin_granted", subjectUserId: "u1" }))).toBeNull();
    expect(flagTrailRowFor(event("league_created", { name: "x" }))).toBeNull();
    expect(flagTrailRowFor(event("session_started", {}))).toBeNull();
  });
});

describe("formatFlagCursor / parseFlagCursor — the queue's pagination cursor (fix round 1, FIX 3)", () => {
  it("round-trips a real cursor", () => {
    const cursor = { raisedAt: "2026-08-01T00:00:00.000Z", id: "flag_1" };
    expect(parseFlagCursor(formatFlagCursor(cursor))).toEqual(cursor);
  });

  it("refuses a string with no separator at all", () => {
    expect(parseFlagCursor("not-a-real-cursor")).toBeNull();
  });

  it("refuses a string whose separator is the very first character", () => {
    expect(parseFlagCursor("|flag_1")).toBeNull();
  });

  it("refuses a cursor with an empty id", () => {
    expect(parseFlagCursor("2026-08-01T00:00:00.000Z|")).toBeNull();
  });

  it("refuses a raisedAt that isn't ISO-instant shaped", () => {
    expect(parseFlagCursor("2026-08-01|flag_1")).toBeNull();
  });

  it("refuses a raisedAt that is ISO-instant SHAPED but not a real date", () => {
    expect(parseFlagCursor("2026-13-40T25:99:99.999Z|flag_1")).toBeNull();
  });
});
