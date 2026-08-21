import { describe, expect, it } from "vitest";
import { isExpired, nextStatusFor, transitionIsLegal, TERMINAL_STATUSES, TRADE_STATUSES, type TradeTransition } from "./lifecycle";

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
});
