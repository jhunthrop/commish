import { describe, expect, it } from "vitest";
import type { BoardReason } from "@/projections/preseason/board";
import { FAIR_PRICE_BAND_POINTS, verdictLine } from "./verdict";

const SCARCITY: BoardReason = { code: "scarcity", positionRank: 21, replacementLevel: 140.2 };
const TIER_CLIFF: BoardReason = { code: "tier_cliff", playersLeftInTier: 3, dropToNextTier: 4.2 };

describe("verdictLine", () => {
  it("no-reasons-at-all: null when the board never ranked him", () => {
    expect(verdictLine([], "WR")).toBeNull();
  });

  it("going later than he should: drafters undervalue the evidence", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: 14.2 }, SCARCITY];
    const line = verdictLine(reasons, "WR");
    expect(line).toContain("He is going later than he should");
    expect(line).toContain("worth about 14 more points than where he is being drafted");
    expect(line).toContain("He sits WR21.");
  });

  it("a reach: drafters overvalue the evidence", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: -9.5 }, SCARCITY];
    const line = verdictLine(reasons, "RB");
    expect(line).toContain("He is a reach where he is going");
    expect(line).toContain("about 9 points under his draft slot");
  });

  it("about right: a delta inside the band reads as agreement, not a direction", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: FAIR_PRICE_BAND_POINTS - 1 }, SCARCITY];
    const line = verdictLine(reasons, "TE");
    expect(line).toContain("Drafters have him about right");
    expect(line).not.toContain("going later than he should");
    expect(line).not.toContain("a reach");
  });

  it("a delta exactly at the band edge still counts as a stated direction, not \"about right\" (the band is < not <=)", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: FAIR_PRICE_BAND_POINTS }, SCARCITY];
    expect(verdictLine(reasons, "TE")).toContain("going later than he should");
  });

  it("no ADP, with a position rank on record: the evidence alone states his rank", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_unlisted" }, SCARCITY];
    const line = verdictLine(reasons, "RB");
    expect(line).toBe("The evidence makes him RB21. He has no ADP.");
  });

  it("no ADP, with nothing else on record either: the honest last resort", () => {
    const reasons: readonly BoardReason[] = [{ code: "rookie", overallPick: 42, landingMultiplier: 1 }];
    expect(verdictLine(reasons, "RB")).toBe("He has no ADP. The evidence stands alone.");
  });

  /** Fantasy words, not trading words (founder, 2026-09-07): no branch says market or price. */
  it("speaks in fantasy football's own words on every branch", () => {
    const branches = [
      verdictLine([{ code: "market_anchor", marketPoints: 200, delta: 14.2 }, SCARCITY], "WR"),
      verdictLine([{ code: "market_anchor", marketPoints: 200, delta: -9.5 }, SCARCITY], "RB"),
      verdictLine([{ code: "market_anchor", marketPoints: 200, delta: 1 }, SCARCITY], "TE"),
      verdictLine([{ code: "market_unlisted" }, SCARCITY, TIER_CLIFF], "WR"),
      verdictLine([{ code: "rookie", overallPick: 42, landingMultiplier: 1 }], "RB"),
    ];
    for (const line of branches) expect(line).not.toMatch(/\b(market|price|priced|pricing)\b/i);
  });

  it("a tier cliff supersedes the plain position-rank supporting clause", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: 14.2 }, SCARCITY, TIER_CLIFF];
    const line = verdictLine(reasons, "WR");
    expect(line).toContain("Three left in his tier before a 4.2 point drop.");
    expect(line).not.toContain("He sits WR21");
  });

  it("a tier cliff also supports the no-ADP branch", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_unlisted" }, SCARCITY, TIER_CLIFF];
    const line = verdictLine(reasons, "WR");
    expect(line).toBe("The evidence makes him WR21. He has no ADP. Three left in his tier before a 4.2 point drop.");
  });

  it("leads with the written call when the capsule has one, and keeps the measured facts under it", () => {
    const reasons: readonly BoardReason[] = [{ code: "market_anchor", marketPoints: 200, delta: -9.5 }, SCARCITY, TIER_CLIFF];
    const line = verdictLine(reasons, "RB", { call: "He is the engine of that offense and the room has not caught up." })!;

    expect(line.startsWith("He is the engine of that offense and the room has not caught up.")).toBe(true);
    // Nothing measured leaves the page in exchange for voice.
    expect(line).toContain("He is a reach where he is going");
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
