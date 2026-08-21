import { describe, expect, it } from "vitest";
import { SYSTEM_ACTION_CODES, SYSTEM_ACTION_VISIBILITY, systemActionSummaryAllowed, type SystemActionCode } from "./system-actions";

describe("SYSTEM_ACTION_VISIBILITY", () => {
  it("decides every system action code in the vocabulary, deny by default", () => {
    expect(Object.keys(SYSTEM_ACTION_VISIBILITY).sort()).toEqual([...SYSTEM_ACTION_CODES].sort());
  });

  it("allows two codes to everyone: stat_week_corrected and draft_auto_started, both facts about nobody's conduct", () => {
    expect(SYSTEM_ACTION_VISIBILITY.stat_week_corrected).toBe("everyone");
    expect(SYSTEM_ACTION_VISIBILITY.draft_auto_started).toBe("everyone");
  });

  it("scopes lineup_auto_set to its subject alone, the actor-scoped path Plan B pre-decided, corrected to subject", () => {
    expect(SYSTEM_ACTION_VISIBILITY.lineup_auto_set).toBe("subject_only");
  });

  it("hides chain_verification_failed, restating ruling 8 rather than leaving it to the renderer alone", () => {
    expect(SYSTEM_ACTION_VISIBILITY.chain_verification_failed).toBe("hidden");
  });

  it("hides trade_held_for_review and tier_blocked_join — both platform-chain, never read by a league feed at all", () => {
    expect(SYSTEM_ACTION_VISIBILITY.trade_held_for_review).toBe("hidden");
    expect(SYSTEM_ACTION_VISIBILITY.tier_blocked_join).toBe("hidden");
  });

  it("is a real Record over the whole union, so a code added later without an entry does not compile", () => {
    // Compile-time proof, made visible in the suite: every SystemActionCode indexes into the
    // table without a cast. The runtime assertion above is what actually fails if a value ever
    // reads back `undefined` for a key TypeScript believes is present.
    const values: readonly string[] = SYSTEM_ACTION_CODES.map((code: SystemActionCode) => SYSTEM_ACTION_VISIBILITY[code]);
    expect(values.every((value) => value === "everyone" || value === "subject_only" || value === "hidden")).toBe(true);
  });
});

describe("systemActionSummaryAllowed", () => {
  it("keeps every previously-decided code exactly where Plan B left it — a zero-line diff for the three existing consumers", () => {
    expect(systemActionSummaryAllowed("stat_week_corrected")).toBe(true);
    expect(systemActionSummaryAllowed("chain_verification_failed")).toBe(false);
    expect(systemActionSummaryAllowed("trade_held_for_review")).toBe(false);
  });

  it("is true only for a code SYSTEM_ACTION_VISIBILITY marks everyone, never for subject_only or hidden", () => {
    for (const code of SYSTEM_ACTION_CODES) {
      expect(systemActionSummaryAllowed(code)).toBe(SYSTEM_ACTION_VISIBILITY[code] === "everyone");
    }
    expect(systemActionSummaryAllowed("lineup_auto_set")).toBe(false);
    expect(systemActionSummaryAllowed("tier_blocked_join")).toBe(false);
  });

  it("allows draft_auto_started now that it has a visibility decision, even though it has no publisher yet", () => {
    expect(systemActionSummaryAllowed("draft_auto_started")).toBe(true);
  });
});
