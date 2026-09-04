import { describe, expect, it } from "vitest";
import { AUDIT_EVENT_TYPES, type AuditEvent, type AuditEventType, type JsonObject } from "@/domain/audit";
import { ACTIVITY_VISIBILITY, activityRowFor, type ActivityVisibility } from "./activity-view";
import { copyViolations } from "./copy-rules";
import { systemActionSummaryAllowed } from "./system-actions";

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

/** A `system_action` event, actorless (the platform, never a person) unless a test overrides it. */
function systemActionEvent(payload: JsonObject): AuditEvent {
  return event("system_action", payload, null);
}

/**
 * The real payload `scripts/verify-audit-chain.ts`'s `recordDetection` writes — copied rather
 * than paraphrased, so a Plan D author reading this file finds the actual shape the gate has to
 * keep denying, not a stand-in for it.
 */
function chainVerificationFailedEvent(): AuditEvent {
  return systemActionEvent({ action: "chain_verification_failed", scopes: ["platform"], checkedAt: "2026-08-20T17:00:00.000Z" });
}

/**
 * The same real shape, PLUS a synthetic `summary` (fix round 1, F4) — the verifier writes no
 * summary today, so `chainVerificationFailedEvent()` above is denied by the "no summary" check
 * alone and never actually exercises the allowlist itself. This variant is what the gate test
 * below needs: with a summary present, only `SYSTEM_ACTION_SUMMARY_ALLOWED.chain_verification_
 * failed === false` is left to deny it, so deleting THAT check (not the summary check) is what
 * this pins.
 */
function chainVerificationFailedEventWithSummary(): AuditEvent {
  return systemActionEvent({
    action: "chain_verification_failed",
    scopes: ["platform"],
    checkedAt: "2026-08-20T17:00:00.000Z",
    summary: "Some chains failed verification.",
  });
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
  // TWO shapes out of one renderer, the same `draft_pick` split above: `stat_week_corrected` is
  // "everyone" in SYSTEM_ACTION_VISIBILITY (see ./system-actions), so it renders for any viewer;
  // `lineup_auto_set` is "subject_only", so its sample carries `subjectUserId` matching this
  // file's own `viewer` (`user_bob`) — a sample naming a DIFFERENT subject would render null and
  // fail the "breaks none of the house copy rules" sweep below, which is the point: this sample
  // set is swept for what actually renders, not for what the type union merely contains.
  system_action: [
    {
      payload: {
        action: "stat_week_corrected",
        summary: "We corrected week 4 scores after our stats provider revised its numbers. Standings now match the update.",
      },
      actorId: null,
    },
    {
      payload: { action: "lineup_auto_set", subjectUserId: "user_bob", summary: "We set your week 4 lineup." },
      actorId: null,
    },
  ],
  // Task 5 (ruling 12): both flipped to `"everyone"`, and rendered for real — `renderRosterMove`
  // covers the `"trade_reversed"` reason too, in `activityRowFor`'s own describe block below.
  roster_move: [{ payload: { reason: "trade", tradeId: "trade_1", proposerTeamId: "team_1", counterpartyTeamId: "team_2", proposerAssetIds: ["player_1"], counterpartyAssetIds: ["player_1"] }, actorId: "user_bob" }],
  trade_proposed: [{ payload: {}, actorId: "user_bob" }],
  trade_accepted: [
    { payload: { tradeId: "trade_1", proposerTeamId: "team_1", counterpartyTeamId: "team_2", proposerAssetIds: ["player_1"], counterpartyAssetIds: ["player_1"] }, actorId: "user_bob" },
  ],
  trade_rejected: [{ payload: {}, actorId: "user_bob" }],
  flag_raised: [{ payload: {}, actorId: null }],
  flag_resolved: [{ payload: {}, actorId: null }],
  admin_action: [{ payload: {}, actorId: null }],
  session_started: [{ payload: {}, actorId: "user_bob" }],
  profile_updated: [{ payload: {}, actorId: "user_bob" }],
  review_removed: [{ payload: {}, actorId: "user_bob" }],
  // Phase 4, Task 2: all ten money events land hidden (see ACTIVITY_VISIBILITY), so these
  // placeholder samples render nothing today — the task that flips one to "everyone" replaces
  // its sample with the real payload shape, and this Record's exhaustiveness is what makes
  // forgetting that a type error rather than an unswept sentence.
  deposit_completed: [{ payload: {}, actorId: "user_bob" }],
  deposit_returned: [{ payload: {}, actorId: null }],
  withdrawal_requested: [{ payload: {}, actorId: "user_bob" }],
  withdrawal_completed: [{ payload: {}, actorId: null }],
  withdrawal_returned: [{ payload: {}, actorId: null }],
  // Task 8: both flipped to `"everyone"` (the Task 2 review's pre-ruling — the fee is a
  // published league term), with the REAL payload shape `collectEntryFeeInTx`/
  // `refundEntryFeeInTx` (`@/money-service/entry-fee`) write, so the copy sweep runs over the
  // sentences members actually read.
  entry_fee_collected: [{ payload: { amountCents: 20_00 }, actorId: "user_bob" }],
  entry_fee_refunded: [{ payload: { amountCents: 20_00 }, actorId: "user_bob" }],
  // Task 10: flipped to `"everyone"` (the Task 2 pre-ruling — a published prize is a league
  // fact), with the REAL payload shape `settleSeasonPayouts` (`@/money-service/settlement`)
  // writes, so the copy sweep runs over the sentence members actually read.
  prize_paid: [{ payload: { winnerUserId: "user_alice", place: 1, amountCents: 44_00, operatorUserId: "user_op" }, actorId: null }],
  // Task 10 ruled these two HIDDEN, permanently: a hold names a suspicion (operator console
  // only), so these placeholder samples render nothing — the same "exhaustiveness forces a
  // decision" reason the self-exclusion trio below keeps placeholders.
  payout_held: [{ payload: {}, actorId: null }],
  payout_released: [{ payload: {}, actorId: null }],
  // Task 7's fix round: these three land HIDDEN, PERMANENTLY — a person's own private compliance
  // facts, never a league feed's business (controller ruling; see `ACTIVITY_VISIBILITY`'s own
  // comment). Placeholder samples for the same "exhaustiveness forces a decision" reason the money
  // ones above use, even though nothing will ever flip these to renderable.
  self_exclusion_set: [{ payload: {}, actorId: "user_bob" }],
  self_exclusion_cleared: [{ payload: {}, actorId: null }],
  kyc_status_changed: [{ payload: {}, actorId: "user_bob" }],
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
    for (const type of ["trade_proposed", "trade_rejected", "flag_raised", "flag_resolved", "admin_action"] as const) {
      expect(ACTIVITY_VISIBILITY[type]).toBe("hidden");
    }
  });

  it("publishes trade_accepted and roster_move — Task 5's own flip (ruling 12)", () => {
    expect(ACTIVITY_VISIBILITY.trade_accepted).toBe("everyone");
    expect(ACTIVITY_VISIBILITY.roster_move).toBe("everyone");
  });

  it("hides the platform chain's types, which can never appear in a league feed anyway", () => {
    for (const type of ["session_started", "profile_updated", "review_removed"] as const) {
      expect(ACTIVITY_VISIBILITY[type]).toBe("hidden");
    }
  });

  it("hides every platform-private money event, and BOTH hold events — a hold names a suspicion (Task 10's ruling)", () => {
    for (const type of [
      "deposit_completed",
      "deposit_returned",
      "withdrawal_requested",
      "withdrawal_completed",
      "withdrawal_returned",
      "payout_held",
      "payout_released",
    ] as const) {
      expect(ACTIVITY_VISIBILITY[type]).toBe("hidden");
    }
  });

  it("publishes prize_paid — Task 10's flip, on the Task 2 pre-ruling that a published prize is a league fact", () => {
    expect(ACTIVITY_VISIBILITY.prize_paid).toBe("everyone");
  });

  it("publishes entry_fee_collected and entry_fee_refunded — Task 8's flip, on the Task 2 pre-ruling that the fee is a published league term", () => {
    expect(ACTIVITY_VISIBILITY.entry_fee_collected).toBe("everyone");
    expect(ACTIVITY_VISIBILITY.entry_fee_refunded).toBe("everyone");
  });

  it("hides self-exclusion and KYC status events, permanently — a person's own private facts (Task 7's fix round)", () => {
    for (const type of ["self_exclusion_set", "self_exclusion_cleared", "kyc_status_changed"] as const) {
      expect(ACTIVITY_VISIBILITY[type]).toBe("hidden");
    }
  });
});

describe("activityRowFor", () => {
  it("renders a human pick with the round and the pick number", () => {
    expect(activityRowFor(event("draft_pick", { ...pickPayload }, "user_alice"), viewer, names)).toEqual({
      eventId: "evt_1",
      occurredAt: "2026-08-20T17:00:00.000Z",
      icon: "draft-pick",
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

  it("renders a seat release as leaving, not joining — the frozen-enum compromise's other sentence", () => {
    // Task 7's coverage-backlog item, cleared here where Task 8 makes the branch matter: a paid
    // seat's release now writes this row BESIDE the refund row, and both must read honestly.
    expect(activityRowFor(event("member_joined", { teamId: "team_1", outcome: "seat_released" }, "user_alice"), viewer, names)).toMatchObject({
      icon: "users",
      headline: "Alice left the league before the draft.",
    });
  });

  it("renders an entry fee collection with the amount, through formatUsd (Task 8)", () => {
    expect(activityRowFor(event("entry_fee_collected", { amountCents: 20_00 }, "user_bob"), viewer, names)).toEqual({
      eventId: "evt_1",
      occurredAt: "2026-08-20T17:00:00.000Z",
      icon: "check",
      headline: "Bob paid the $20.00 entry fee.",
      detail: null,
    });
  });

  it("renders an entry fee refund as the money's own motion, whatever door sent it back", () => {
    expect(activityRowFor(event("entry_fee_refunded", { amountCents: 20_00 }, "user_alice"), viewer, names)).toEqual({
      eventId: "evt_1",
      occurredAt: "2026-08-20T17:00:00.000Z",
      icon: "refresh-cw",
      headline: "The $20.00 entry fee went back to Alice.",
      detail: null,
    });
  });

  it("denies a fee event whose amount is missing or not a whole number of cents, rather than crash formatUsd on it", () => {
    expect(activityRowFor(event("entry_fee_collected", {}, "user_bob"), viewer, names)).toBeNull();
    expect(activityRowFor(event("entry_fee_collected", { amountCents: 20.5 }, "user_bob"), viewer, names)).toBeNull();
    expect(activityRowFor(event("entry_fee_refunded", {}, "user_bob"), viewer, names)).toBeNull();
    expect(activityRowFor(event("entry_fee_refunded", { amountCents: 20.5 }, "user_bob"), viewer, names)).toBeNull();
  });

  it("renders a paid prize from the payload's own winner, never the (null) actor (Task 10)", () => {
    expect(activityRowFor(event("prize_paid", { winnerUserId: "user_alice", place: 2, amountCents: 32_00, operatorUserId: "user_op" }, null), viewer, names)).toEqual({
      eventId: "evt_1",
      occurredAt: "2026-08-20T17:00:00.000Z",
      icon: "payout",
      headline: "Alice won $32.00 for finishing 2nd.",
      detail: null,
    });
  });

  it("denies a prize event whose payload cannot make an honest sentence", () => {
    expect(activityRowFor(event("prize_paid", {}, null), viewer, names)).toBeNull();
    expect(activityRowFor(event("prize_paid", { winnerUserId: "user_alice", place: 1.5, amountCents: 32_00 }, null), viewer, names)).toBeNull();
    expect(activityRowFor(event("prize_paid", { winnerUserId: "user_alice", place: 1, amountCents: 32.5 }, null), viewer, names)).toBeNull();
    expect(activityRowFor(event("prize_paid", { place: 1, amountCents: 32_00 }, null), viewer, names)).toBeNull();
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
    const summary = "We corrected week 4 scores after our stats provider revised its numbers. Standings now match the update.";
    expect(activityRowFor(systemActionEvent({ action: "stat_week_corrected", summary }), viewer, names)).toMatchObject({
      icon: "alert-triangle",
      headline: summary,
    });
    // No summary, no row. A system action that cannot explain itself does not get a feed entry,
    // even for an action code the allowlist has signed off on.
    expect(activityRowFor(systemActionEvent({ action: "stat_week_corrected" }), viewer, names)).toBeNull();
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
    expect(activityRowFor(chainVerificationFailedEvent(), viewer, names)).toBeNull();
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
      icon: "draft-pick",
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

  /**
   * NEW-2. Names and a league name reach a headline, and the rows they come from predate the
   * boundary schemas that now refuse a hostile one. Milder than HIGH-2 because these sentences
   * re-render on every read rather than being frozen by ruling 12 — a repaired row repairs the
   * feed — but it is the same class, and the guard belongs on both surfaces or on neither.
   */
  it("strips characters a reader cannot see out of every name it interpolates", () => {
    const rtl = String.fromCharCode(0x202e);
    const zeroWidth = String.fromCharCode(0x200b);
    const hostileNames = {
      member: () => `${rtl}Ada Lovelace`,
      player: () => `Bijan${zeroWidth} Robinson`,
      team: () => `${rtl}Alice's team`,
    };

    const created = activityRowFor(event("league_created", { name: `${rtl}Sunday Money`, teamCount: 10 }, "user_alice"), viewer, hostileNames);
    expect(created?.headline).toBe('Ada Lovelace created the league "Sunday Money".');

    const human = activityRowFor(event("draft_pick", pickPayload, "user_alice"), viewer, hostileNames);
    expect(human?.headline).toBe("Ada Lovelace drafted Bijan Robinson.");

    const clock = activityRowFor(event("draft_pick", { ...pickPayload, auto: true }, null), viewer, hostileNames);
    expect(clock?.headline).toBe("The clock ran out, so Alice's team drafted Bijan Robinson from their queue.");

    // Belt and brace stated as one assertion: nothing invisible survives anywhere in the output.
    for (const row of [created, human, clock]) {
      expect(`${row?.headline ?? ""} ${row?.detail ?? ""}`).not.toMatch(/[\u202a-\u202e\u200b-\u200f\u2066-\u2069]/);
    }
  });

  it("sweeps every non-hidden type, so a type flipped visible cannot land unswept", () => {
    const swept = new Set(EVERY_RENDERABLE_SAMPLE.map((sample) => sample.eventType));
    const visible = (Object.keys(ACTIVITY_VISIBILITY) as readonly AuditEventType[]).filter((type) => ACTIVITY_VISIBILITY[type] !== "hidden");
    expect([...swept].sort()).toEqual([...visible].sort());
  });
});

/**
 * Task 10's re-review, pinned. `SYSTEM_ACTION_SUMMARY_ALLOWED` (`./system-actions`) is the third
 * deny-by-default dimension this gate closure adds, and these three states are what it has to
 * hold to: an action nobody signed off (even carrying a summary), an action code this process has
 * never heard of, and the verifier's own event — WITH a synthetic summary added (fix round 1, F4:
 * the verifier writes no summary today, so the real payload alone denies on the "no summary" check
 * without ever touching the allowlist; `chainVerificationFailedEventWithSummary()` is what
 * actually isolates the allowlist's own denial). Deleting the allowlist guard in
 * `renderSystemAction` reddens every one of these three rather than nothing — that is the mutation
 * proof the brief asks for.
 */
describe("renderTradeAccepted", () => {
  const payload: JsonObject = {
    tradeId: "trade_1",
    proposerTeamId: "team_1",
    counterpartyTeamId: "team_2",
    proposerAssetIds: ["player_1"],
    counterpartyAssetIds: ["player_2"],
  };

  it("names both teams and both sides in full — a trade the league can see half of is a rumour", () => {
    expect(activityRowFor(event("trade_accepted", payload, "user_alice"), viewer, names)).toEqual({
      eventId: "evt_1",
      occurredAt: "2026-08-20T17:00:00.000Z",
      icon: "trade",
      headline: "Alice's team and Another team completed a trade.",
      detail: "Alice's team sent Bijan Robinson and got A player who is no longer listed.",
    });
  });

  it("denies a payload missing an asset list", () => {
    const { proposerAssetIds: _omit, ...withoutGive } = payload;
    void _omit;
    expect(activityRowFor(event("trade_accepted", withoutGive, "user_alice"), viewer, names)).toBeNull();
  });

  it("denies a payload whose asset list isn't an array of ids", () => {
    expect(activityRowFor(event("trade_accepted", { ...payload, proposerAssetIds: "player_1" }, "user_alice"), viewer, names)).toBeNull();
  });

  it("denies a payload whose asset list is an array holding a non-string entry", () => {
    expect(activityRowFor(event("trade_accepted", { ...payload, proposerAssetIds: [1] }, "user_alice"), viewer, names)).toBeNull();
  });
});

describe("renderRosterMove", () => {
  const payload: JsonObject = {
    reason: "trade",
    tradeId: "trade_1",
    proposerTeamId: "team_1",
    counterpartyTeamId: "team_2",
    proposerAssetIds: ["player_1"],
    counterpartyAssetIds: ["player_2"],
  };

  it("renders for reason 'trade'", () => {
    expect(activityRowFor(event("roster_move", payload, "user_alice"), viewer, names)).toEqual({
      eventId: "evt_1",
      occurredAt: "2026-08-20T17:00:00.000Z",
      icon: "trade",
      headline: "Alice's team and Another team swapped rosters.",
      detail: null,
    });
  });

  it("renders for reason 'trade_reversed' too, the reason a later reversal writes", () => {
    expect(activityRowFor(event("roster_move", { ...payload, reason: "trade_reversed" }, "user_alice"), viewer, names)).toMatchObject({
      headline: "Alice's team and Another team's roster swap was reversed.",
    });
  });

  it("denies any reason it does not recognize, rather than guessing a sentence", () => {
    expect(activityRowFor(event("roster_move", { ...payload, reason: "waiver" }, "user_alice"), viewer, names)).toBeNull();
    expect(activityRowFor(event("roster_move", { tradeId: "trade_1" }, "user_alice"), viewer, names)).toBeNull();
  });

  it("denies a recognized reason missing the proposer team id", () => {
    const { proposerTeamId: _omit, ...withoutProposer } = payload;
    void _omit;
    expect(activityRowFor(event("roster_move", withoutProposer, "user_alice"), viewer, names)).toBeNull();
  });

  it("denies a recognized reason missing the counterparty team id", () => {
    const { counterpartyTeamId: _omit, ...withoutCounterparty } = payload;
    void _omit;
    expect(activityRowFor(event("roster_move", withoutCounterparty, "user_alice"), viewer, names)).toBeNull();
  });
});

describe("renderSystemAction — the visibility gate", () => {
  it("renders nothing for a hidden action, even when it carries a summary", () => {
    const denied = systemActionEvent({ action: "trade_held_for_review", summary: "A trade is on hold." });
    expect(systemActionSummaryAllowed("trade_held_for_review")).toBe(false); // the precondition this test is actually about
    expect(activityRowFor(denied, viewer, names)).toBeNull();
  });

  it("renders nothing for an action code it has never heard of", () => {
    expect(activityRowFor(systemActionEvent({ action: "whatever", summary: "hi" }), viewer, names)).toBeNull();
  });

  it("renders nothing for a payload carrying no action at all", () => {
    expect(activityRowFor(systemActionEvent({ summary: "hi" }), viewer, names)).toBeNull();
  });

  it("still renders nothing for the verifier's own event, even carrying a summary, which is Plan A's ruling 8 unchanged", () => {
    expect(activityRowFor(chainVerificationFailedEventWithSummary(), viewer, names)).toBeNull();
  });
});

/**
 * The FOURTH deny-by-default dimension's own case: `lineup_auto_set` is `"subject_only"`, not
 * `"everyone"` and not `"actor_only"` — a system action has no actor, by construction (Plan B's
 * pre-decided path, corrected by one word). `SYSTEM_ACTION_SUMMARY_ALLOWED` used to deny this code
 * outright; it is now `"subject_only"` in `SYSTEM_ACTION_VISIBILITY`, so it renders for exactly
 * the member the payload names as `subjectUserId` and nobody else.
 */
describe("renderSystemAction — lineup_auto_set, the subject-scoped case", () => {
  it("shows an auto-set lineup to the manager it happened to and to nobody else", () => {
    const alice = { userId: "user_alice" };
    const autoSet = systemActionEvent({ action: "lineup_auto_set", subjectUserId: "user_alice", summary: "We set your lineup for week 4." });
    expect(activityRowFor(autoSet, alice, names)).toMatchObject({ icon: "alert-triangle", headline: "We set your lineup for week 4." });
    expect(activityRowFor(autoSet, viewer, names)).toBeNull();
  });

  it("renders nothing at all for a subject_only action whose payload names no subject", () => {
    // Deny by default on a malformed or tampered payload, the same `return null` the rest of this
    // module holds every renderer to. A missing subject must not mean "show everyone".
    const noSubject = systemActionEvent({ action: "lineup_auto_set", summary: "We set a lineup." });
    expect(activityRowFor(noSubject, { userId: "user_alice" }, names)).toBeNull();
  });

  it("renders nothing when the subject named does not match this viewer, even a close one", () => {
    const autoSet = systemActionEvent({ action: "lineup_auto_set", subjectUserId: "user_alice", summary: "We set your lineup for week 4." });
    expect(activityRowFor(autoSet, { userId: "user_bob" }, names)).toBeNull();
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
