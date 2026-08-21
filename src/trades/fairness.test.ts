import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { tradeBalance, fairnessGap, crossesFairnessThreshold, type ValuedPlayer, type TradeBalance } from "./fairness";
import { tradeBalance as reExported } from "@/ai-advisor/valuation";

describe("one fairness function, one home", () => {
  it("is the same function object the advisor calls, not a copy that could drift", () => {
    // Founder decision: the strategy doc's whole dual-use thesis is that a member and the
    // platform read ONE verdict. Two exported functions that happen to agree today is the
    // thing this assertion exists to make impossible.
    expect(reExported).toBe(tradeBalance);
  });

  it("leaves no second implementation behind in the advisor", () => {
    // A grep, not an import check: a re-export satisfies the identity test above even if
    // somebody later pastes the arithmetic back in beside it.
    const source = readFileSync(join(process.cwd(), "src", "ai-advisor", "valuation.ts"), "utf8");
    expect(source).not.toContain("ADVISOR_CONFIG.lopsidedDelta");
    expect(source).not.toContain("ADVISOR_CONFIG.evenDelta");
  });
});

const rb = (playerId: string, averagePoints: number): ValuedPlayer =>
  ({ playerId, name: playerId, position: "RB", averagePoints });

describe("tradeBalance", () => {
  it("is lenient at BOTH boundaries, exactly as docs/advisor.md documents", () => {
    // gap === evenDelta (3) is still "even" (gap <= evenDelta), and gap === lopsidedDelta (12)
    // is NOT flagged (the flag fires on gap > lopsidedDelta). Both spellings are load-bearing
    // now that an integrity threshold sits on the same axis.
    expect(tradeBalance([rb("a", 13)], [rb("b", 10)]).verdict).toBe("even");
    expect(tradeBalance([rb("a", 22)], [rb("b", 10)]).flags).toEqual([]);
    expect(tradeBalance([rb("a", 22.1)], [rb("b", 10)]).flags).toEqual(["value_gap_over_threshold"]);
  });

  it("reports the direction the delta actually points", () => {
    // delta = giving - receiving. Positive means the PROPOSER sends more value out, which is
    // the receiver's side of a favour, and the naming has been wrong in two other codebases.
    expect(tradeBalance([rb("a", 18)], [rb("b", 10)]).delta).toBe(8);
    expect(tradeBalance([rb("a", 18)], [rb("b", 10)]).verdict).toBe("favors_receiver");
    expect(tradeBalance([rb("a", 10)], [rb("b", 18)]).verdict).toBe("favors_proposer");
  });

  it("calls an empty side lopsided rather than infinitely favourable", () => {
    expect(tradeBalance([], [rb("b", 10)]).flags).toEqual(["empty_side", "uneven_player_count"]);
    expect(tradeBalance([], [rb("b", 10)]).verdict).toBe("lopsided");
  });

  it("flags empty on the RECEIVING side too — the OR's other operand", () => {
    const balance = tradeBalance([rb("a", 10)], []);
    expect(balance.flags).toEqual(["empty_side", "uneven_player_count"]);
    expect(balance.verdict).toBe("lopsided");
  });

  it("flags an uneven count with neither side empty", () => {
    const balance = tradeBalance([rb("a", 5), rb("b", 5)], [rb("c", 9)]);
    expect(balance.flags).toContain("uneven_player_count");
    expect(balance.flags).not.toContain("empty_side");
  });

  it("sums and rounds both sides the way the rest of the product rounds points", () => {
    const balance = tradeBalance([rb("a", 10.005), rb("b", 1)], [rb("c", 2.5)]);
    expect(balance.givingValue).toBe(11.01);
    expect(balance.receivingValue).toBe(2.5);
    expect(balance.delta).toBe(8.51);
  });
});

function balanceWithDelta(delta: number): TradeBalance {
  return tradeBalance([rb("a", 10 + Math.max(delta, 0))], [rb("b", 10 + Math.max(-delta, 0))]);
}

describe("fairnessGap", () => {
  it("is the absolute distance between the two sides, regardless of direction", () => {
    expect(fairnessGap(balanceWithDelta(8))).toBe(8);
    expect(fairnessGap(balanceWithDelta(-8))).toBe(8);
    expect(fairnessGap(balanceWithDelta(0))).toBe(0);
  });
});

describe("crossesFairnessThreshold", () => {
  it("is inclusive at the boundary — >=, not >, unlike tradeBalance's own lopsidedDelta", () => {
    const balance = balanceWithDelta(20);
    expect(crossesFairnessThreshold(balance, 20)).toBe(true);
    expect(crossesFairnessThreshold(balance, 21)).toBe(false);
  });

  it("never crosses when the threshold is null — how Plan D's auto-hold ships inert", () => {
    expect(crossesFairnessThreshold(balanceWithDelta(1000), null)).toBe(false);
  });
});
