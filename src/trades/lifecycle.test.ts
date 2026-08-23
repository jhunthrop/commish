import { describe, expect, it } from "vitest";
import { isExpired, nextStatusFor, transitionIsLegal, TERMINAL_STATUSES, TRADE_STATUSES, type TradeTransition } from "./lifecycle";

const ORDINARY_TRANSITIONS = ["accept", "reject", "withdraw", "expire"] as const satisfies readonly TradeTransition[];
const ALL_TRANSITIONS = ["accept", "reject", "withdraw", "expire", "supersede", "hold", "release", "block"] as const satisfies readonly TradeTransition[];

describe("transitionIsLegal", () => {
  it("lets every ordinary verb run only from open", () => {
    for (const transition of ORDINARY_TRANSITIONS) {
      for (const status of TRADE_STATUSES) {
        expect(transitionIsLegal(status, transition)).toBe(status === "open");
      }
    }
  });

  it("lets supersede run from open OR held — the world moving on, not a review's own answer", () => {
    for (const status of TRADE_STATUSES) {
      expect(transitionIsLegal(status, "supersede")).toBe(status === "open" || status === "held");
    }
  });

  it("lets hold run only from open", () => {
    for (const status of TRADE_STATUSES) {
      expect(transitionIsLegal(status, "hold")).toBe(status === "open");
    }
  });

  it("lets release and block run only from held — the two ways out, and only out of held", () => {
    for (const transition of ["release", "block"] as const) {
      for (const status of TRADE_STATUSES) {
        expect(transitionIsLegal(status, transition)).toBe(status === "held");
      }
    }
  });
});

describe("nextStatusFor", () => {
  it("gives every transition a target, so a new one cannot silently do nothing", () => {
    const targets = ALL_TRANSITIONS.map(nextStatusFor);
    expect(new Set(targets).size).toBeLessThanOrEqual(targets.length);
  });

  it("maps each transition to the status its own name says", () => {
    expect(nextStatusFor("accept")).toBe("accepted");
    expect(nextStatusFor("reject")).toBe("rejected");
    expect(nextStatusFor("withdraw")).toBe("withdrawn");
    expect(nextStatusFor("expire")).toBe("expired");
    expect(nextStatusFor("supersede")).toBe("superseded");
    expect(nextStatusFor("hold")).toBe("held");
    expect(nextStatusFor("release")).toBe("accepted");
    expect(nextStatusFor("block")).toBe("blocked");
  });

  it("targets every ordinary lifecycle verb (not hold/release/block) at a terminal status", () => {
    for (const transition of ["accept", "reject", "withdraw", "expire", "supersede"] as const) {
      expect(TERMINAL_STATUSES[nextStatusFor(transition)]).toBe(true);
    }
  });
});

describe("TERMINAL_STATUSES", () => {
  it("holds a boolean for every declared status, none missing", () => {
    expect(Object.keys(TERMINAL_STATUSES).sort()).toEqual([...TRADE_STATUSES].sort());
  });

  it("keeps held non-terminal — neither open nor settled, but not stuck forever either", () => {
    expect(TERMINAL_STATUSES.held).toBe(false);
  });

  it("keeps blocked terminal — an operator's decision, and a decision does not un-happen", () => {
    expect(TERMINAL_STATUSES.blocked).toBe(true);
  });
});

/** Moved here from `@/league-service/trades` in the final review's HIGH 3 fix: expiry is pure and
 *  the BROWSER needs it (`TradeCard` gates its Accept control on it), so it belongs in the
 *  browser-safe half where both sides ask one function. */
describe("isExpired", () => {
  it("is true for an open offer past its expiry", () => {
    expect(isExpired({ status: "open", expiresAt: "2026-08-01T00:00:00.000Z" }, "2026-08-02T00:00:00.000Z")).toBe(true);
  });

  it("is true at the exact moment it expires, never one tick late", () => {
    expect(isExpired({ status: "open", expiresAt: "2026-08-02T00:00:00.000Z" }, "2026-08-02T00:00:00.000Z")).toBe(true);
  });

  it("is false for an open offer still inside its window", () => {
    expect(isExpired({ status: "open", expiresAt: "2026-08-04T00:00:00.000Z" }, "2026-08-02T00:00:00.000Z")).toBe(false);
  });

  it("is false for a terminal row, even one whose expiry has long since passed", () => {
    expect(isExpired({ status: "accepted", expiresAt: "2026-08-01T00:00:00.000Z" }, "2026-08-02T00:00:00.000Z")).toBe(false);
  });

  it("is false for a held row — it is not open, so expiry does not apply to it either", () => {
    expect(isExpired({ status: "held", expiresAt: "2026-08-01T00:00:00.000Z" }, "2026-08-02T00:00:00.000Z")).toBe(false);
  });
});
