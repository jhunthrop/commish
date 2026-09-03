import { describe, expect, it } from "vitest";
import { QUILT_CONFIG } from "./config";
import { beginPendingPick, undoWindowMs } from "./pending-pick";

const NOW = Date.parse("2026-09-02T18:00:00.000Z");
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString();

describe("undoWindowMs", () => {
  it("grants the full window against a roomy deadline", () => {
    expect(undoWindowMs(NOW, iso(60_000))).toBe(QUILT_CONFIG.undoWindowMs);
  });

  it("grants the full window when there is no deadline at all", () => {
    expect(undoWindowMs(NOW, null)).toBe(QUILT_CONFIG.undoWindowMs);
  });

  it("squeezes to an immediate submit when the deadline is inside window + margin", () => {
    expect(undoWindowMs(NOW, iso(QUILT_CONFIG.undoWindowMs + QUILT_CONFIG.undoSqueezeMarginMs))).toBe(0);
    expect(undoWindowMs(NOW, iso(1_000))).toBe(0);
    expect(undoWindowMs(NOW, iso(-1_000))).toBe(0);
  });

  it("treats an unparseable deadline as no deadline", () => {
    expect(undoWindowMs(NOW, "not-a-date")).toBe(QUILT_CONFIG.undoWindowMs);
  });
});

describe("beginPendingPick", () => {
  it("holds the pick for the window against a roomy deadline", () => {
    const held = beginPendingPick("p1", NOW, iso(60_000));
    expect(held).toEqual({ playerId: "p1", commitsAt: NOW + QUILT_CONFIG.undoWindowMs, swappedFromPlayerId: null });
  });

  it("remembers the player a swap replaced", () => {
    const held = beginPendingPick("p2", NOW, iso(60_000), "p1");
    expect(held?.swappedFromPlayerId).toBe("p1");
  });

  it("returns null — submit now — under the squeeze rule", () => {
    expect(beginPendingPick("p1", NOW, iso(2_000))).toBeNull();
  });
});
