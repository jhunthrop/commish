import { describe, expect, it } from "vitest";
import { nextStatusFor, transitionIsLegal, TERMINAL_STATUSES, TRADE_STATUSES, type TradeTransition } from "./lifecycle";

describe("transitionIsLegal", () => {
  it("lets nothing out of a terminal status, including back to open", () => {
    for (const status of TRADE_STATUSES) {
      expect(transitionIsLegal(status)).toBe(status === "open");
    }
  });
});

describe("nextStatusFor", () => {
  it("gives every transition a target, so a new one cannot silently do nothing", () => {
    const targets = (["accept", "reject", "withdraw", "expire", "supersede"] as const satisfies readonly TradeTransition[]).map(nextStatusFor);
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets.every((target) => TERMINAL_STATUSES[target])).toBe(true);
  });

  it("maps each transition to the status its own name says", () => {
    expect(nextStatusFor("accept")).toBe("accepted");
    expect(nextStatusFor("reject")).toBe("rejected");
    expect(nextStatusFor("withdraw")).toBe("withdrawn");
    expect(nextStatusFor("expire")).toBe("expired");
    expect(nextStatusFor("supersede")).toBe("superseded");
  });
});
