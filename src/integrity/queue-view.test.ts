import { describe, expect, it } from "vitest";
import type { AuditEvent, AuditEventType, JsonObject } from "@/domain/audit";
import { TRADE_FAIRNESS_BASES } from "@/integrity/flags";
import { ACTIVITY_VISIBILITY, activityRowFor } from "./activity-view";
import {
  flagDetailFor,
  flagTrailRowFor,
  formatFlagCursor,
  parseFlagCursor,
  queueRowFor,
  subjectIsAlreadyReversed,
  subjectPlayersMovedAgain,
  TRADE_FAIRNESS_BASIS_PHRASE,
  tradeFairnessBasisPhrase,
  tradeFairnessGapPhrase,
  type FlagSubjectView,
} from "./queue-view";

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
    for (const flagType of ["multi_account", "review_report", "chat_report", "trade_fairness", "trade_hold"] as const) {
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

    const released = flagTrailRowFor(event("flag_resolved", { flagId: "flag_1", decision: "trade_released" }));
    expect(released?.headline).toBe("An operator released the trade.");

    const blocked = flagTrailRowFor(event("flag_resolved", { flagId: "flag_1", decision: "trade_blocked" }));
    expect(blocked?.headline).toBe("An operator blocked the trade.");

    const malformed = flagTrailRowFor(event("flag_resolved", { flagId: "flag_1", decision: "not_a_real_decision" }));
    expect(malformed?.headline).toBe("An operator resolved this flag.");

    // A row missing `decision` entirely (a malformed or pre-migration payload) reads the same
    // honest fallback as an unrecognized string — `payloadStr`'s own `undefined` branch.
    const missing = flagTrailRowFor(event("flag_resolved", { flagId: "flag_1" }));
    expect(missing?.headline).toBe("An operator resolved this flag.");
  });

  it("reads a SYSTEM resolution as the platform's own, never an operator's (Plan D, fix round 1)", () => {
    // `actorId: null` is the exact construction `closeSupersededHoldFlag` writes
    // (`@/integrity-service/trade-fairness`) — the same "no human decided this" shape every other
    // system-authored event in this product carries.
    const systemResolved = flagTrailRowFor({ ...event("flag_resolved", { flagId: "flag_1", decision: "superseded_before_review" }), actorId: null });
    expect(systemResolved?.headline).toBe("The platform closed this flag once a different trade superseded it.");
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

  describe("the trade branch (Task 6)", () => {
    const names = new Map([
      ["u_alice", "Alice"],
      ["u_bob", "Bob"],
    ]);

    it("renders a trade being offered, in the actor's own name", () => {
      const row = event("trade_proposed", { tradeId: "trade_1", proposerTeamId: "team_a", counterpartyTeamId: "team_b" }, "league_1");
      const rendered = flagTrailRowFor({ ...row, actorId: "u_alice" }, names);
      expect(rendered).toMatchObject({ headline: "Alice offered this trade." });
    });

    it("renders a trade being accepted, in the actor's own name", () => {
      const row = event("trade_accepted", { tradeId: "trade_1", proposerTeamId: "team_a", counterpartyTeamId: "team_b" }, "league_1");
      const rendered = flagTrailRowFor({ ...row, actorId: "u_bob" }, names);
      expect(rendered).toMatchObject({ headline: "Bob accepted it." });
    });

    it("falls back to 'A former member' for an actor id the names map has no entry for, or none at all", () => {
      const proposed = event("trade_proposed", { tradeId: "trade_1" }, "league_1");
      expect(flagTrailRowFor({ ...proposed, actorId: "u_ghost" }, names)?.headline).toBe("A former member offered this trade.");
      expect(flagTrailRowFor({ ...proposed, actorId: null }, names)?.headline).toBe("A former member offered this trade.");
    });

    it("falls back to the same honest name with NO map supplied at all — the default-parameter seam every other call site relies on", () => {
      const proposed = event("trade_proposed", { tradeId: "trade_1" }, "league_1");
      expect(flagTrailRowFor({ ...proposed, actorId: "u_alice" })?.headline).toBe("A former member offered this trade.");
    });

    it("renders a trade's own roster_move generically — no team names, just the fact", () => {
      const row = event("roster_move", { reason: "trade", tradeId: "trade_1", proposerTeamId: "team_a", counterpartyTeamId: "team_b" }, "league_1");
      expect(flagTrailRowFor(row)?.headline).toBe("Two players changed teams.");
    });

    it("renders the reversal's own roster_move distinctly, Task 7 — reversed, not a second trade (fix round 2, F2 naming)", () => {
      const row = event("roster_move", { reason: "trade_reversed", tradeId: "trade_1", flagId: "flag_1" }, "league_1");
      expect(flagTrailRowFor(row)?.headline).toBe("An operator reversed the trade.");
    });

    it("denies a roster_move for any reason other than 'trade' or 'trade_reversed'", () => {
      const row = event("roster_move", { reason: "waiver", tradeId: "trade_1" }, "league_1");
      expect(flagTrailRowFor(row)).toBeNull();
    });

    it("denies a roster_move with no reason at all, the same malformed-payload discipline every other renderer holds to", () => {
      const row = event("roster_move", { tradeId: "trade_1" }, "league_1");
      expect(flagTrailRowFor(row)).toBeNull();
    });
  });

  describe("the held-trade branch (Plan D, Task 5)", () => {
    it("renders the hold itself, off the platform chain", () => {
      const row = event("system_action", { action: "trade_held_for_review", tradeId: "trade_1" }, "platform");
      expect(flagTrailRowFor(row)).toMatchObject({ headline: "The platform held this trade for a fairness review." });
    });

    it("denies every other system_action code, deny-by-default", () => {
      expect(flagTrailRowFor(event("system_action", { action: "tier_blocked_join", subjectUserId: "u1" }))).toBeNull();
      expect(flagTrailRowFor(event("system_action", { action: "lineup_auto_set", subjectUserId: "u1" }))).toBeNull();
      expect(flagTrailRowFor(event("system_action", {}))).toBeNull();
    });
  });
});

describe("FlagSubjectView's trade arm (Task 6)", () => {
  it("carries both team names, both sides' historical valuation, when it was accepted, and whether it's since been reversed", () => {
    const subject: FlagSubjectView = {
      kind: "trade",
      tradeId: "trade_1",
      proposerTeamName: "Team Alice",
      counterpartyTeamName: "Team Bob",
      gave: [{ playerId: "p1", name: "Star RB", position: "RB", averagePoints: 22.4 }],
      got: [{ playerId: "p2", name: "Bench WR", position: "WR", averagePoints: 3.1 }],
      acceptedAt: "2026-08-10T00:00:00.000Z",
      reversedAt: null,
      valuationBasis: "The platform valued this trade the moment it was accepted.",
      fairnessGapSummary: "The two sides differ by 19.3 points per week, at or past the 20-point threshold that raised this flag.",
      playersMovedAgain: false,
    };
    const detail = flagDetailFor({ ...flag, flagType: "trade_fairness" }, subject, [], []);
    expect(detail.subject).toBe(subject);
  });
});

describe("flagDetailFor's decisions narrow on the SUBJECT, Task 7", () => {
  const tradeSubject: FlagSubjectView = {
    kind: "trade",
    tradeId: "trade_1",
    proposerTeamName: "Team Alice",
    counterpartyTeamName: "Team Bob",
    gave: [],
    got: [],
    acceptedAt: "2026-08-10T00:00:00.000Z",
    reversedAt: null,
    valuationBasis: "The platform valued this trade the moment it was accepted.",
    fairnessGapSummary: "The two sides differ by 19.3 points per week, at or past the 20-point threshold that raised this flag.",
    playersMovedAgain: false,
  };

  it("offers a trade reversal for a reversible trade subject, and no content removal (a trade is not content)", () => {
    const detail = flagDetailFor({ ...flag, flagType: "trade_fairness" }, tradeSubject, [], []);
    expect(detail.decisions).toEqual(["no_action", "warned_user", "trade_reversed"]);
  });

  it("never offers a trade reversal on a chat report — the wrong subject type entirely", () => {
    const chatSubject: FlagSubjectView = { kind: "chat_message", messageId: "5", body: "hi", authorName: "Bob", removedAt: null };
    const detail = flagDetailFor({ ...flag, flagType: "chat_report" }, chatSubject, [], []);
    expect(detail.decisions).not.toContain("trade_reversed");
  });

  it("never offers a trade reversal a second time, once the trade is already reversed", () => {
    const alreadyReversed: FlagSubjectView = { ...tradeSubject, reversedAt: "2026-08-15T00:00:00.000Z" };
    expect(subjectIsAlreadyReversed(alreadyReversed)).toBe(true);
    const detail = flagDetailFor({ ...flag, flagType: "trade_fairness" }, alreadyReversed, [], []);
    expect(detail.decisions).toEqual(["no_action", "warned_user"]);
  });

  it("answers false for any non-trade subject and for an un-reversed trade", () => {
    expect(subjectIsAlreadyReversed(tradeSubject)).toBe(false);
    expect(subjectIsAlreadyReversed({ kind: "review", reviewId: "r1", body: "x", authorName: "A", removedAt: null })).toBe(false);
  });

  /**
   * Fix round 1 (LOW, M8 discipline). `playersMovedAgain`'s own precomputed state withholds
   * `trade_reversed` the SAME way `subjectIsAlreadyReversed` does, for the other reason a
   * reversal can refuse: the world moved on, not that it already happened.
   */
  it("never offers a trade reversal once a traded player has moved on since, and offers no_action/warned_user instead", () => {
    const movedAgain: FlagSubjectView = { ...tradeSubject, playersMovedAgain: true };
    expect(subjectPlayersMovedAgain(movedAgain)).toBe(true);
    const detail = flagDetailFor({ ...flag, flagType: "trade_fairness" }, movedAgain, [], []);
    expect(detail.decisions).toEqual(["no_action", "warned_user"]);
  });

  it("answers false for subjectPlayersMovedAgain on any non-trade subject and on an unaffected trade", () => {
    expect(subjectPlayersMovedAgain(tradeSubject)).toBe(false);
    expect(subjectPlayersMovedAgain({ kind: "chat_message", messageId: "5", body: "hi", authorName: "Bob", removedAt: null })).toBe(false);
  });

  const heldTradeSubject: FlagSubjectView = {
    kind: "held_trade",
    tradeId: "trade_1",
    proposerTeamName: "Team Alice",
    counterpartyTeamName: "Team Bob",
    gave: [],
    got: [],
    valuationBasis: "The platform valued this trade the moment it was accepted.",
    fairnessGapSummary: "The two sides differ by 40 points per week, at or past the 35-point threshold that raised this flag.",
    proposerManager: { userId: "u_alice", name: "Alice", joinedAt: "2026-01-01T00:00:00.000Z", completedSeasons: 3 },
    counterpartyManager: { userId: "u_bob", name: "Bob", joinedAt: "2026-02-01T00:00:00.000Z", completedSeasons: 0 },
  };

  it("offers exactly trade_released and trade_blocked for a held_trade subject — no no_action, no warned_user, no reversal", () => {
    const detail = flagDetailFor({ ...flag, flagType: "trade_hold" }, heldTradeSubject, [], []);
    expect(detail.decisions).toEqual(["trade_released", "trade_blocked"]);
  });

  it("never offers trade_released/trade_blocked on any other subject kind", () => {
    const detail = flagDetailFor({ ...flag, flagType: "trade_fairness" }, tradeSubject, [], []);
    expect(detail.decisions).not.toContain("trade_released");
    expect(detail.decisions).not.toContain("trade_blocked");
  });
});

describe("FlagSubjectView's held_trade arm (Plan D, Task 5)", () => {
  it("carries both managers' own standing beside the players changing hands", () => {
    const subject: FlagSubjectView = {
      kind: "held_trade",
      tradeId: "trade_1",
      proposerTeamName: "Team Alice",
      counterpartyTeamName: "Team Bob",
      gave: [{ playerId: "p1", name: "Star RB", position: "RB", averagePoints: 22.4 }],
      got: [{ playerId: "p2", name: "Bench WR", position: "WR", averagePoints: 3.1 }],
      valuationBasis: "The platform valued this trade the moment it was accepted.",
      fairnessGapSummary: "The two sides differ by 40 points per week, at or past the 35-point threshold that raised this flag.",
      proposerManager: { userId: "u_alice", name: "Alice", joinedAt: "2026-01-01T00:00:00.000Z", completedSeasons: 3 },
      counterpartyManager: { userId: "u_bob", name: "Bob", joinedAt: null, completedSeasons: 0 },
    };
    const detail = flagDetailFor({ ...flag, flagType: "trade_hold" }, subject, [], []);
    expect(detail.subject).toBe(subject);
  });
});

describe("tradeFairnessBasisPhrase (Task 6 fix round 1, review MEDIUM 1)", () => {
  it("puts each declared basis in active-voice, operator-facing plain language", () => {
    expect(tradeFairnessBasisPhrase("accept_evaluation")).toBe("The platform valued this trade the moment it was accepted.");
    expect(tradeFairnessBasisPhrase("sweep_rederivation")).toBe(
      "The fairness sweep valued this trade later, from the rosters as they stood when it ran.",
    );
  });

  it("answers honestly, never a guess, for a flag that predates basis tracking", () => {
    expect(tradeFairnessBasisPhrase(null)).toBe("This flag predates valuation-basis tracking, so the method isn't recorded.");
  });

  it("contains no em dash in any of its sentences", () => {
    for (const basis of [...TRADE_FAIRNESS_BASES, null] as const) {
      expect(tradeFairnessBasisPhrase(basis)).not.toContain("—");
    }
  });

  it("is exhaustive over every declared TradeFairnessBasis — a Record, not a partial map", () => {
    expect(Object.keys(TRADE_FAIRNESS_BASIS_PHRASE).sort()).toEqual([...TRADE_FAIRNESS_BASES].sort());
  });
});

describe("tradeFairnessGapPhrase (fix round 2, F3)", () => {
  it("names the gap and the threshold, in points per week, in one active-voice sentence", () => {
    expect(tradeFairnessGapPhrase(19.3, 20)).toBe("The two sides differ by 19.3 points per week, at or past the 20-point threshold that raised this flag.");
  });

  it("says nothing about verdict or severity — ruling 30, the same discipline valuationBasis already holds to", () => {
    const phrase = tradeFairnessGapPhrase(60, 20);
    expect(phrase.toLowerCase()).not.toContain("lopsided");
    expect(phrase.toLowerCase()).not.toContain("severe");
  });

  it("answers honestly, never a guess, when either number is missing", () => {
    expect(tradeFairnessGapPhrase(null, 20)).toBe("This flag predates gap tracking, so the number isn't recorded.");
    expect(tradeFairnessGapPhrase(19.3, null)).toBe("This flag predates gap tracking, so the number isn't recorded.");
    expect(tradeFairnessGapPhrase(null, null)).toBe("This flag predates gap tracking, so the number isn't recorded.");
  });

  it("contains no em dash in any of its sentences", () => {
    expect(tradeFairnessGapPhrase(19.3, 20)).not.toContain("—");
    expect(tradeFairnessGapPhrase(null, null)).not.toContain("—");
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
