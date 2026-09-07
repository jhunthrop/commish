import { describe, expect, it } from "vitest";
import type { BoardReason } from "@/projections/preseason/board";
import { FAIR_PRICE_BAND_POINTS, verdictLine } from "./verdict";

const SCARCITY: BoardReason = { code: "scarcity", positionRank: 21, replacementLevel: 140.2 };
const TIER_CLIFF: BoardReason = { code: "tier_cliff", playersLeftInTier: 3, dropToNextTier: 4.2 };

describe("verdictLine", () => {
  it("no-reasons-at-all: null when the board never ranked him", () => {
    expect(verdictLine([], "WR")).toBeNull();
  });

  it("under-priced: the market undervalues the evidence", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: 14.2 }, SCARCITY];
    const line = verdictLine(reasons, "WR");
    expect(line).toContain("The market is underpricing him");
    expect(line).toContain("worth about 14 more points");
    expect(line).toContain("He sits WR21.");
  });

  it("over-priced: the market overvalues the evidence", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: -9.5 }, SCARCITY];
    const line = verdictLine(reasons, "RB");
    expect(line).toContain("The market is overpricing him");
    expect(line).toContain("about 9 points under his price");
  });

  it("fairly-priced: a delta inside the band reads as agreement, not a direction", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: FAIR_PRICE_BAND_POINTS - 1 }, SCARCITY];
    const line = verdictLine(reasons, "TE");
    expect(line).toContain("about right");
    expect(line).not.toContain("underpricing");
    expect(line).not.toContain("overpricing");
  });

  it("a delta exactly at the band edge still counts as a stated direction, not \"about right\" (the band is < not <=)", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: FAIR_PRICE_BAND_POINTS }, SCARCITY];
    expect(verdictLine(reasons, "TE")).toContain("underpricing");
  });

  it("no-market, with a position rank on record: the evidence alone states his rank", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_unlisted" }, SCARCITY];
    const line = verdictLine(reasons, "RB");
    expect(line).toBe("The evidence makes him RB21. The market has not priced him.");
  });

  it("no-market, with nothing else on record either: the honest last resort", () => {
    const reasons: readonly BoardReason[] = [{ code: "rookie", overallPick: 42, landingMultiplier: 1 }];
    expect(verdictLine(reasons, "RB")).toBe("The market has not priced him. The evidence stands alone.");
  });

  it("a tier cliff supersedes the plain position-rank supporting clause", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: 14.2 }, SCARCITY, TIER_CLIFF];
    const line = verdictLine(reasons, "WR");
    expect(line).toContain("Three left in his tier before a 4.2 point drop.");
    expect(line).not.toContain("He sits WR21");
  });

  it("a tier cliff also supports the no-market branch", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_unlisted" }, SCARCITY, TIER_CLIFF];
    const line = verdictLine(reasons, "WR");
    expect(line).toBe("The evidence makes him WR21. The market has not priced him. Three left in his tier before a 4.2 point drop.");
  });

  it("leads with the written call when the capsule has one, and keeps the measured facts under it", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: -9.5 }, SCARCITY, TIER_CLIFF];
    const line = verdictLine(reasons, "RB", { call: "He is the engine of that offense and the price has not caught up." })!;

    expect(line.startsWith("He is the engine of that offense and the price has not caught up.")).toBe(true);
    // Nothing measured leaves the page in exchange for voice.
    expect(line).toContain("The market is overpricing him");
    expect(line).toContain("Three left in his tier before a 4.2 point drop.");
  });

  it("renders the written tier sentence in place of the template one, never both", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: -9.5 }, SCARCITY, TIER_CLIFF];
    const line = verdictLine(reasons, "RB", { tier: "Two backs stand between him and a real drop, so waiting has a price." })!;

    expect(line).toContain("Two backs stand between him and a real drop");
    expect(line).not.toContain("Three left in his tier");
  });

  it("ignores a written tier sentence when the board found no cliff, whatever the capsule says", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: -9.5 }, SCARCITY];
    const line = verdictLine(reasons, "RB", { tier: "Two backs stand between him and a real drop." })!;

    expect(line).not.toContain("Two backs stand between him");
    expect(line).toContain("He sits RB21.");
  });

  it("falls back to the whole template line when the capsule wrote nothing", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: -9.5 }, SCARCITY];
    expect(verdictLine(reasons, "RB", {})).toBe(verdictLine(reasons, "RB"));
  });

  it("never renders an em-dash", () => {
    const cases: (readonly BoardReason[])[] = [
      [{ code: "market_anchor", marketPoints: 200, delta: 14.2 }, SCARCITY, TIER_CLIFF],
      [{ code: "market_anchor", marketPoints: 200, delta: -9.5 }, SCARCITY],
      [{ code: "market_unlisted" }, SCARCITY],
      [{ code: "rookie", overallPick: null, landingMultiplier: 1 }],
    ];
    for (const reasons of cases) {
      expect(verdictLine(reasons, "WR")).not.toMatch(/—/);
    }
  });
});
