import { describe, expect, it } from "vitest";
import { groupReasons } from "@/league-room/outlook/groups";
import type { BoardReason } from "@/projections/preseason/board";
import { strongestEvidenceSentence, tierBandLabel, tierBandSentence, vsMarketLabel } from "./copy";

describe("vsMarketLabel", () => {
  it("returns null for no market data", () => {
    expect(vsMarketLabel(null)).toBeNull();
  });

  it("states the value case in words, whole picks, positive tone", () => {
    expect(vsMarketLabel(25.3)).toEqual({ text: "drafters take him 25 picks later", tone: "positive" });
  });

  it("states the reach case in words, whole picks, NEUTRAL tone, never negative", () => {
    expect(vsMarketLabel(-17.4)).toEqual({ text: "drafters reach 17 picks early", tone: "neutral" });
  });

  it("singularizes exactly one pick", () => {
    expect(vsMarketLabel(1)).toEqual({ text: "drafters take him 1 pick later", tone: "positive" });
    expect(vsMarketLabel(-1)).toEqual({ text: "drafters reach 1 pick early", tone: "neutral" });
  });

  it("a gap rounding to zero reads as even, neutral, no verdict", () => {
    expect(vsMarketLabel(0.4)).toEqual({ text: "even with ADP", tone: "neutral" });
    expect(vsMarketLabel(-0.4)).toEqual({ text: "even with ADP", tone: "neutral" });
  });
});

describe("tierBandSentence", () => {
  it("spells out a single player left as the word 'one'", () => {
    expect(tierBandSentence("S", "RB", 1, 6.4)).toBe("Tier S · one RB left before a 6.4 point drop");
  });

  it("prints a numeral for more than one", () => {
    expect(tierBandSentence("A", "WR", 4, 2.2)).toBe("Tier A · 4 WR left before a 2.2 point drop");
  });

  it("states the count alone when there is no next-tier drop to name", () => {
    expect(tierBandSentence("C", "K", 3, 0)).toBe("Tier C · 3 K left");
  });

  /** The Overall ladder (the Draft area round, 2026-09-12): a band across positions counts
   *  players, since "3 ALL left" is not a sentence anyone would say out loud. */
  it("counts players, not a position, on the band across the whole board", () => {
    expect(tierBandLabel("ALL", 5, 19.3)).toBe("5 players left before a 19.3 point drop");
    expect(tierBandLabel("ALL", 1, 19.3)).toBe("one player left before a 19.3 point drop");
    expect(tierBandLabel("ALL", 21, 0)).toBe("21 players left");
  });
});

describe("strongestEvidenceSentence", () => {
  it("states the strongest law group's own sentence (groupReasons already sorts strongest first)", () => {
    const reasons: readonly BoardReason[] = [
      { code: "law", lawId: "td_regression", effect: -0.5, magnitude: 1.5 },
      { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
    ];
    const groups = groupReasons(reasons, []);
    expect(strongestEvidenceSentence(groups)).toBe("-1.8 pts, Age 29 season");
  });

  it("returns null when nothing fired at all", () => {
    expect(strongestEvidenceSentence([])).toBeNull();
  });

  it("returns null for a fact-only reason list (nothing law-strength to lead with)", () => {
    const reasons: readonly BoardReason[] = [{ code: "changed_team", from: "DAL", to: "SF" }];
    const groups = groupReasons(reasons, []);
    expect(strongestEvidenceSentence(groups)).toBeNull();
  });
});
