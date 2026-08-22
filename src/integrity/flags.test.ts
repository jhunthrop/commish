import { describe, expect, it } from "vitest";
import {
  DECISION_OWNER,
  DECISION_WIRED_FOR,
  FLAG_SUBJECT_TYPES,
  FLAG_TYPES,
  RESOLUTION_DECISIONS,
  SUBJECT_OF,
  contentRemovalIsWiredFor,
  decisionIsAvailable,
  decisionIsWiredFor,
} from "./flags";

describe("the resolution vocabulary", () => {
  it("asks whether a decision is wired, not which plan wrote it", () => {
    // `decisionIsAvailable` used to be `DECISION_OWNER[d] === "plan-b"`, which was the right
    // question while those two facts agreed. Plan C is where they part: `trade_reversed` is
    // still owned by plan-c and is now wired, so ownership stops being able to answer.
    expect(RESOLUTION_DECISIONS.filter(decisionIsAvailable)).toEqual([
      "no_action",
      "warned_user",
      "content_removed",
      "trade_reversed",
      "trade_released",
      "trade_blocked",
    ]);
    expect(DECISION_OWNER.trade_reversed).toBe("plan-c"); // provenance survives the wiring
    expect(DECISION_OWNER.trade_released).toBe("plan-d");
    expect(DECISION_OWNER.trade_blocked).toBe("plan-d");
  });

  it("says which subjects each decision can actually be carried out against, in one table", () => {
    // The two-axis version of Plan B's LOW 13: `resolveFlagSchema` accepted `content_removed` for
    // ANY flag, and a direct POST against an `account_pair` reached an unwired branch and became
    // a 500. A 500 is not a refusal. One table, exhaustive on both axes, so a new decision or a
    // new subject without a wiring row fails to compile.
    expect(DECISION_WIRED_FOR.content_removed).toEqual({ review: true, chat_message: true, account_pair: false, trade: false, held_trade: false });
    expect(DECISION_WIRED_FOR.trade_reversed).toEqual({ review: false, chat_message: false, account_pair: false, trade: true, held_trade: false });
    expect(DECISION_WIRED_FOR.no_action).toEqual({ review: true, chat_message: true, account_pair: true, trade: true, held_trade: false });
  });

  it("wires trade_released and trade_blocked for held_trade alone — Plan D's two ways out, and nothing else", () => {
    expect(DECISION_WIRED_FOR.trade_released).toEqual({ review: false, chat_message: false, account_pair: false, trade: false, held_trade: true });
    expect(DECISION_WIRED_FOR.trade_blocked).toEqual({ review: false, chat_message: false, account_pair: false, trade: false, held_trade: true });
  });

  it("wires nothing but trade_released/trade_blocked for held_trade — no_action and warned_user would strand a waiting trade", () => {
    for (const decision of RESOLUTION_DECISIONS) {
      const shouldBeWired = decision === "trade_released" || decision === "trade_blocked";
      expect(decisionIsWiredFor(decision, "held_trade")).toBe(shouldBeWired);
    }
  });

  it("keeps contentRemovalIsWiredFor answering exactly what it answered before", () => {
    // Derived from the new table rather than deleted, so the diff at Plan B's three consumers
    // (the detail page, resolveFlag's pre-write refusal, removeSubject's backstop) is zero. The
    // same "a re-export is what makes this a de-duplication rather than a refactor" discipline
    // ruling 21 of Plan B used for src/moderation.
    for (const subject of FLAG_SUBJECT_TYPES) {
      expect(contentRemovalIsWiredFor(subject)).toBe(DECISION_WIRED_FOR.content_removed[subject]);
    }
  });

  it("still declares account_restricted nowhere at all", () => {
    // Founder decision 5, unchanged and re-asserted here because this is the commit that makes a
    // reserved decision real, and the next reader will wonder whether the other one is next.
    expect(RESOLUTION_DECISIONS as readonly string[]).not.toContain("account_restricted");
  });

  it("names trade_reversed's own owner, provenance surviving the wiring", () => {
    expect(RESOLUTION_DECISIONS).toContain("trade_reversed");
    expect(DECISION_OWNER.trade_reversed).toBe("plan-c");
  });

  it("assigns every declared decision an owning plan, or fails to compile", () => {
    // DECISION_OWNER is an exhaustive Record over the union, so this assertion is belt to the
    // type system's braces and exists so the property is visible in the suite.
    expect(Object.keys(DECISION_OWNER).sort()).toEqual([...RESOLUTION_DECISIONS].sort());
  });

  it("assigns every declared decision a wiring row for every subject type, or fails to compile", () => {
    for (const decision of RESOLUTION_DECISIONS) {
      expect(Object.keys(DECISION_WIRED_FOR[decision]).sort()).toEqual([...FLAG_SUBJECT_TYPES].sort());
      for (const subject of FLAG_SUBJECT_TYPES) {
        expect(decisionIsWiredFor(decision, subject)).toBe(DECISION_WIRED_FOR[decision][subject]);
      }
    }
  });
});

describe("the flag vocabulary", () => {
  it("names one flag type per detector, with its subject", () => {
    expect(FLAG_TYPES).toEqual(["multi_account", "review_report", "chat_report", "trade_fairness", "trade_hold"]);
    expect(SUBJECT_OF.multi_account).toBe("account_pair");
    expect(SUBJECT_OF.trade_fairness).toBe("trade");
    expect(SUBJECT_OF.trade_hold).toBe("held_trade");
  });

  it("keeps trade_hold's subject distinct from trade_fairness's own, even naming the same trade id", () => {
    // A held trade never executed; a fairness-flagged one already did. Two subject types, so the
    // open-flag uniqueness index and every reader's exhaustive Record say which is which without
    // re-deriving it from context.
    expect(SUBJECT_OF.trade_hold).not.toBe(SUBJECT_OF.trade_fairness);
  });

  it("assigns every flag type a declared subject type, or fails to compile", () => {
    // SUBJECT_OF is an exhaustive Record over FlagType, same discipline as DECISION_OWNER above.
    expect(Object.values(SUBJECT_OF).every((subject) => (FLAG_SUBJECT_TYPES as readonly string[]).includes(subject))).toBe(true);
    expect(Object.keys(SUBJECT_OF).sort()).toEqual([...FLAG_TYPES].sort());
  });
});
