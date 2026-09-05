import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import type { BoardReason } from "@/projections/preseason/board";
import { RUN_THRESHOLD, RUN_WINDOW, detectRun, tierCountdowns } from "./reads";

function positions(...list: Position[]): readonly Position[] {
  return list;
}

describe("detectRun", () => {
  it("detects a run when 5 of the last 7 picks share a position", () => {
    const recent = positions("RB", "WR", "RB", "RB", "RB", "QB", "RB");
    expect(detectRun(recent)).toEqual({ position: "RB", count: 5, window: RUN_WINDOW });
  });

  it("does not fire on 4 of 7", () => {
    const recent = positions("RB", "WR", "RB", "RB", "RB", "QB", "TE");
    expect(detectRun(recent)).toBeNull();
  });

  it("only looks at the last RUN_WINDOW picks, ignoring older history", () => {
    // 8 picks total: the oldest RB drops out of the 7-pick window, leaving only 4 RB in-window.
    const recent = positions("RB", "RB", "WR", "RB", "RB", "RB", "QB", "TE");
    expect(detectRun(recent)).toBeNull();
  });

  it("uses the actual length early in the draft, when fewer than RUN_WINDOW picks exist", () => {
    const recent = positions("RB", "RB", "RB", "RB", "RB");
    expect(detectRun(recent)).toEqual({ position: "RB", count: 5, window: 5 });
  });

  it("never fires below RUN_THRESHOLD even with a short window", () => {
    const recent = positions("RB", "RB", "RB");
    expect(detectRun(recent)).toBeNull();
  });

  it("returns null with no picks yet", () => {
    expect(detectRun([])).toBeNull();
  });

  it("exposes RUN_THRESHOLD as 5", () => {
    expect(RUN_THRESHOLD).toBe(5);
  });
});

function tierCliff(playersLeftInTier: number, dropToNextTier: number): BoardReason {
  return { code: "tier_cliff", playersLeftInTier, dropToNextTier };
}

describe("tierCountdowns", () => {
  it("reads the best undrafted player's tier_cliff reason, one row per position", () => {
    const positionsById = new Map<string, Position>([
      ["rb1", "RB"],
      ["wr1", "WR"],
    ]);
    const reasons = new Map<string, BoardReason[]>([
      ["rb1", [tierCliff(2, 4.5)]],
      ["wr1", [tierCliff(1, 3.2)]],
    ]);
    const result = tierCountdowns(["rb1", "wr1"], positionsById, reasons);
    expect(result).toEqual([
      { position: "RB", playersLeftInTier: 2, dropToNextTier: 4.5 },
      { position: "WR", playersLeftInTier: 1, dropToNextTier: 3.2 },
    ]);
  });

  it("skips a position when its best undrafted player has no tier_cliff reason (absence, never a made-up number)", () => {
    const positionsById = new Map<string, Position>([
      ["rb1", "RB"],
      ["wr1", "WR"],
    ]);
    const reasons = new Map<string, BoardReason[]>([["rb1", [tierCliff(2, 4.5)]]]);
    const result = tierCountdowns(["rb1", "wr1"], positionsById, reasons);
    expect(result).toEqual([{ position: "RB", playersLeftInTier: 2, dropToNextTier: 4.5 }]);
  });

  it("takes only the best (first) undrafted player per position, ignoring the rest", () => {
    const positionsById = new Map<string, Position>([
      ["rb1", "RB"],
      ["rb2", "RB"],
    ]);
    const reasons = new Map<string, BoardReason[]>([
      ["rb1", []],
      ["rb2", [tierCliff(3, 2.1)]],
    ]);
    // rb1 is the best RB and has no tier_cliff reason, so RB is skipped entirely even though
    // rb2 (a worse RB) has one — the row belongs to the best player at the position or nobody.
    const result = tierCountdowns(["rb1", "rb2"], positionsById, reasons);
    expect(result).toEqual([]);
  });

  it("returns an empty list when reasons carries nothing for anyone", () => {
    const positionsById = new Map<string, Position>([["rb1", "RB"]]);
    const result = tierCountdowns(["rb1"], positionsById, new Map());
    expect(result).toEqual([]);
  });
});
