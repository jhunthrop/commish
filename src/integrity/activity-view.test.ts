import { describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES, type AuditEvent, type AuditEventType, type JsonObject } from "@/domain/audit";
import { ACTIVITY_VISIBILITY, activityRowFor, type ActivityVisibility } from "./activity-view";
import { copyViolations } from "./copy-rules";

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

/**
 * A sample payload for every type this plan renders, keyed by type so the SET is derived rather
 * than listed. `EVERY_RENDERABLE_SAMPLE` below turns it into the sweep's input by reading
 * `ACTIVITY_VISIBILITY`, which means a type a later plan flips to `"everyone"` is swept the day
 * it flips, and one flipped without a sample here fails loudly instead of silently going
 * unswept. That is the property the old hardcoded seven-element array did not have.
 */
const SAMPLE_PAYLOADS: Readonly<Record<AuditEventType, readonly { readonly payload: JsonObject; readonly actorId: string | null }[]>> = {
  league_created: [
    {
      payload: { name: "Sunday Money", format: "redraft", teamCount: 10, stakeTier: "money", isPublicMatchmade: false, experienceTier: "beginner", scoringPreset: "standard" },
      actorId: "user_alice",
    },
  ],
  member_joined: [{ payload: { teamId: "team_1", via: "invite" }, actorId: "user_bob" }],
  // BOTH `draft_pick` shapes: the one a person submitted and the one the clock made. They are two
  // different sentences out of one renderer, so one sample would sweep half of it.
  draft_pick: [
    { payload: pickPayload, actorId: "user_alice" },
    { payload: { ...pickPayload, auto: true }, actorId: null },
  ],
  draft_completed: [{ payload: { draftId: "d", picks: 120, teams: 10 }, actorId: null }],
  lineup_change: [{ payload: { teamId: "team_2", weekNumber: 3, starters: [] }, actorId: "user_bob" }],
  system_action: [{ payload: { action: "lineup_auto_set", summary: "We set Bob's week 4 lineup for him." }, actorId: null }],
  // Hidden today. A sample is still declared for each so that flipping one to `"everyone"` needs
  // no second edit here and cannot land unswept; the `Record` over the full union is what forces
  // a new vocabulary entry to be considered at all.
  roster_move: [{ payload: {}, actorId: "user_bob" }],
  trade_proposed: [{ payload: {}, actorId: "user_bob" }],
  trade_accepted: [{ payload: {}, actorId: "user_bob" }],
  trade_rejected: [{ payload: {}, actorId: "user_bob" }],
  flag_raised: [{ payload: {}, actorId: null }],
  flag_resolved: [{ payload: {}, actorId: null }],
  admin_action: [{ payload: {}, actorId: null }],
  session_started: [{ payload: {}, actorId: "user_bob" }],
  profile_updated: [{ payload: {}, actorId: "user_bob" }],
  review_removed: [{ payload: {}, actorId: "user_bob" }],
};

/** Every sentence this module can actually produce, derived from the visibility table itself. */
const EVERY_RENDERABLE_SAMPLE: readonly AuditEvent[] = (Object.keys(ACTIVITY_VISIBILITY) as readonly AuditEventType[])
  .filter((type) => ACTIVITY_VISIBILITY[type] !== "hidden")
  .flatMap((type) => SAMPLE_PAYLOADS[type].map((sample) => event(type, sample.payload, sample.actorId)));

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
    expect(activityRowFor(event("system_action", { action: "lineup_auto_set", summary: "We set Bob's week 4 lineup for him." }, null), viewer, names)).toMatchObject({
      icon: "alert-triangle",
      headline: "We set Bob's week 4 lineup for him.",
    });
    // No summary, no row. A system action that cannot explain itself does not get a feed entry.
    expect(activityRowFor(event("system_action", { action: "lineup_auto_set" }, null), viewer, names)).toBeNull();
  });

  /**
   * MEDIUM-1. The only `system_action` publisher that exists writes THIS shape, and it has no
   * `summary`, so the renderer returns null for it. That is correct and deliberate: the event
   * says a chain failed verification, and ruling 8 forbids telling a league its record may have
   * been tampered with before a human has read the output. Pinned with the REAL payload, copied
   * from `scripts/verify-audit-chain.ts`'s `recordDetection`, so a Plan D author reading the
   * ledgered residual finds the property asserted rather than assumed.
   */
  it("renders nothing for the verifier's own failure event, which is the only system_action written today", () => {
    const real: JsonObject = { action: "chain_verification_failed", scopes: ["platform"], checkedAt: "2026-08-20T17:00:00.000Z" };
    expect(activityRowFor(event("system_action", real, null), viewer, names)).toBeNull();
  });

  /**
   * MEDIUM-2. `auditEventsForPicks`' `actorId` expression ends `?? null`, and that fallback is a
   * row it admits it can emit: a contested auction pick whose owner lookup misses. The row says
   * `actorType: "user"` — a person made this pick — and branching on the id rendered the CLOCK
   * sentence for it, which contradicts the event's own statement. `actorType` is the derived,
   * writer-controlled field, and it is what decides the sentence now.
   */
  it("keeps the human sentence for a user-attributed pick whose actor id could not be resolved", () => {
    const orphaned: AuditEvent = { ...event("draft_pick", pickPayload, null), actorType: "user" };
    expect(activityRowFor(orphaned, viewer, names)).toMatchObject({
      icon: "check",
      headline: "A former member drafted Bijan Robinson.",
    });
  });

  /**
   * The SAME rulebook the notice templates are swept against (`copyViolations`, `./copy-rules`),
   * over a sample set derived from `ACTIVITY_VISIBILITY`. Both surfaces are read by the same
   * member on the same page; this used to be the dash rule alone while notices got three.
   */
  it("breaks none of the house copy rules, in any sentence it can produce", () => {
    expect(EVERY_RENDERABLE_SAMPLE.length).toBeGreaterThan(0);
    for (const sample of EVERY_RENDERABLE_SAMPLE) {
      const row = activityRowFor(sample, { userId: sample.actorId ?? viewer.userId }, names);
      expect(row).not.toBeNull();
      expect(copyViolations(`${row?.headline ?? ""} ${row?.detail ?? ""}`)).toEqual([]);
    }
  });

  it("sweeps every non-hidden type, so a type flipped visible cannot land unswept", () => {
    const swept = new Set(EVERY_RENDERABLE_SAMPLE.map((sample) => sample.eventType));
    const visible = (Object.keys(ACTIVITY_VISIBILITY) as readonly AuditEventType[]).filter((type) => ACTIVITY_VISIBILITY[type] !== "hidden");
    expect([...swept].sort()).toEqual([...visible].sort());
  });
});

describe("activityRowFor — deny paths", () => {
  it("denies a type nobody assigned a value to, the same as an explicitly hidden one", () => {
    // A cast, not a real member of AuditEventType: this is the shape a future migration's type
    // would take in a process that hasn't reloaded the union yet. `ACTIVITY_VISIBILITY[type]`
    // reads back `undefined` for it, and `undefined` must deny exactly like `"hidden"` does.
    const fabricated = "future_event_type" as unknown as AuditEventType;
    expect(activityRowFor(event(fabricated, {}, null), viewer, names)).toBeNull();
  });

  it("denies a type its own renderer switch does not handle, even if ACTIVITY_VISIBILITY were somehow made to call it visible", () => {
    // The second, redundant layer the module's docblock argues for: a rolling deploy where
    // ACTIVITY_VISIBILITY has already been updated for a new type but this process's renderer
    // switch has not caught up. That gap cannot be constructed through the public API alone (the
    // first deny path above already closes it before the switch is ever reached), so this test
    // pokes the exported map directly — legal because `Readonly<...>` is a compile-time
    // annotation, not `Object.freeze` — to prove the switch's own `default` genuinely denies
    // rather than throwing or rendering a guess.
    const mutable = ACTIVITY_VISIBILITY as unknown as Record<string, ActivityVisibility>;
    const fabricated = "future_event_type" as unknown as AuditEventType;
    mutable[fabricated] = "everyone";
    try {
      expect(activityRowFor(event(fabricated, {}, null), viewer, names)).toBeNull();
    } finally {
      delete mutable[fabricated];
    }
  });

  it("denies a league_created event with no name to put in the headline", () => {
    expect(activityRowFor(event("league_created", { teamCount: 10 }, "user_alice"), viewer, names)).toBeNull();
  });

  it("omits the team-count detail, without denying the row, when league_created carries no team count", () => {
    expect(activityRowFor(event("league_created", { name: "Sunday Money" }, "user_alice"), viewer, names)).toMatchObject({ detail: null });
  });

  it("denies a draft_pick missing only the round", () => {
    expect(activityRowFor(event("draft_pick", { playerId: "player_1", pickNumber: 24 }, "user_alice"), viewer, names)).toBeNull();
  });

  it("denies a draft_pick missing only the pick number", () => {
    expect(activityRowFor(event("draft_pick", { playerId: "player_1", round: 2 }, "user_alice"), viewer, names)).toBeNull();
  });

  it("denies a clock-made draft_pick with no team to attribute it to", () => {
    // playerId/round/pickNumber are all present; only the system-attribution path's own required
    // field (teamId) is missing, so this exercises a different branch than the "no actor" test above.
    expect(activityRowFor(event("draft_pick", { playerId: "player_1", round: 2, pickNumber: 24 }, null), viewer, names)).toBeNull();
  });

  it("omits the count detail, without denying the row, when draft_completed carries no counts", () => {
    expect(activityRowFor(event("draft_completed", { draftId: "d" }, null), viewer, names)).toMatchObject({
      headline: "The draft is complete.",
      detail: null,
    });
  });

  it("omits the count detail when draft_completed has a pick count but no team count", () => {
    expect(activityRowFor(event("draft_completed", { draftId: "d", picks: 120 }, null), viewer, names)).toMatchObject({ detail: null });
  });

  it("denies a lineup_change with no week number, even for the manager who made it", () => {
    expect(activityRowFor(event("lineup_change", { teamId: "team_2", starters: [] }, "user_bob"), viewer, names)).toBeNull();
  });
});
