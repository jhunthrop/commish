import { describe, expect, it } from "vitest";
import {
  DECISION_OWNER,
  FLAG_SUBJECT_TYPES,
  FLAG_TYPES,
  RESOLUTION_DECISIONS,
  SUBJECT_OF,
  decisionIsAvailable,
} from "./flags";

describe("the resolution vocabulary", () => {
  it("offers an operator only decisions this product can actually carry out", () => {
    expect(RESOLUTION_DECISIONS.filter(decisionIsAvailable)).toEqual(["no_action", "warned_user", "content_removed"]);
  });

  it("declares trade_reversed, names its owner, and refuses it today", () => {
    // The score.update precedent: reserved through one plan, turned on by name in the next.
    expect(RESOLUTION_DECISIONS).toContain("trade_reversed");
    expect(DECISION_OWNER.trade_reversed).toBe("plan-c");
    expect(decisionIsAvailable("trade_reversed")).toBe(false);
  });

  it("does not declare account_restricted at all", () => {
    // Founder decision 5. Unlike trade_reversed it has no owning plan, and the spec's own
    // out-of-scope list forbids any account action in this phase. A reserved name with no owner
    // is how a control wired to nothing gets wired to something by a reader who assumes intent.
    expect(RESOLUTION_DECISIONS as readonly string[]).not.toContain("account_restricted");
  });

  it("assigns every declared decision an owning plan, or fails to compile", () => {
    // DECISION_OWNER is an exhaustive Record over the union, so this assertion is belt to the
    // type system's braces and exists so the property is visible in the suite.
    expect(Object.keys(DECISION_OWNER).sort()).toEqual([...RESOLUTION_DECISIONS].sort());
  });
});

describe("the flag vocabulary", () => {
  it("names one flag type per detector, with its subject", () => {
    expect(FLAG_TYPES).toEqual(["multi_account", "review_report", "chat_report", "trade_fairness"]);
    expect(SUBJECT_OF.multi_account).toBe("account_pair");
    expect(SUBJECT_OF.trade_fairness).toBe("trade");
  });

  it("assigns every flag type a declared subject type, or fails to compile", () => {
    // SUBJECT_OF is an exhaustive Record over FlagType, same discipline as DECISION_OWNER above.
    expect(Object.values(SUBJECT_OF).every((subject) => (FLAG_SUBJECT_TYPES as readonly string[]).includes(subject))).toBe(true);
    expect(Object.keys(SUBJECT_OF).sort()).toEqual([...FLAG_TYPES].sort());
  });

});
