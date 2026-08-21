import { describe, expect, it } from "vitest";
import { SYSTEM_ACTION_CODES, SYSTEM_ACTION_SUMMARY_ALLOWED, type SystemActionCode } from "./system-actions";

describe("SYSTEM_ACTION_SUMMARY_ALLOWED", () => {
  it("decides every system action code in the vocabulary, deny by default", () => {
    expect(Object.keys(SYSTEM_ACTION_SUMMARY_ALLOWED).sort()).toEqual([...SYSTEM_ACTION_CODES].sort());
  });

  it("allows exactly one code today: stat_week_corrected, the plan's own first league-scoped publisher", () => {
    expect(SYSTEM_ACTION_SUMMARY_ALLOWED.stat_week_corrected).toBe(true);
    for (const code of SYSTEM_ACTION_CODES) {
      if (code === "stat_week_corrected") continue;
      expect(SYSTEM_ACTION_SUMMARY_ALLOWED[code]).toBe(false);
    }
  });

  it("denies chain_verification_failed, restating ruling 8 rather than leaving it to the renderer alone", () => {
    expect(SYSTEM_ACTION_SUMMARY_ALLOWED.chain_verification_failed).toBe(false);
  });

  it("denies lineup_auto_set in advance, so a future plan cannot simply flip it without a new visibility", () => {
    expect(SYSTEM_ACTION_SUMMARY_ALLOWED.lineup_auto_set).toBe(false);
  });

  it("denies trade_held_for_review, reserved and undecided rather than defaulted open", () => {
    expect(SYSTEM_ACTION_SUMMARY_ALLOWED.trade_held_for_review).toBe(false);
  });

  it("denies tier_blocked_join — nobody in the league is told a stranger was turned away at the door", () => {
    expect(SYSTEM_ACTION_SUMMARY_ALLOWED.tier_blocked_join).toBe(false);
  });

  it("is a real Record over the whole union, so a code added later without an entry does not compile", () => {
    // Compile-time proof, made visible in the suite: every SystemActionCode indexes into the
    // table without a cast. The runtime assertion above is what actually fails if a value ever
    // reads back `undefined` for a key TypeScript believes is present.
    const values: readonly boolean[] = SYSTEM_ACTION_CODES.map((code: SystemActionCode) => SYSTEM_ACTION_SUMMARY_ALLOWED[code]);
    expect(values.every((value) => typeof value === "boolean")).toBe(true);
  });
});
