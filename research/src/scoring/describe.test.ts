import { describe, it, expect } from "vitest";
import { SCORING_PRESETS } from "@research/domain/scoring";
import { describeScoring } from "./describe";

describe("describeScoring", () => {
  it("names each shipped preset from its own weights", () => {
    expect(describeScoring(SCORING_PRESETS.standard)).toBe("Standard");
    expect(describeScoring(SCORING_PRESETS.ppr)).toBe("PPR");
    expect(describeScoring(SCORING_PRESETS.half_ppr)).toBe("Half PPR");
    expect(describeScoring(SCORING_PRESETS.te_premium)).toBe("PPR, TE premium");
  });

  it("describes a custom league honestly rather than mislabeling it", () => {
    // A commissioner who edits a weight has a league that is not any preset. Calling it "PPR"
    // because one field matches would be a scoreboard-shaped lie on a page people join from.
    expect(describeScoring({ ...SCORING_PRESETS.ppr, pointsPerPassingTouchdown: 6 })).toBe("Custom");
  });

  it("falls to Custom on a near-miss of every preset, one field off each", () => {
    expect(describeScoring({ ...SCORING_PRESETS.standard, pointsPerReception: 0.1 })).toBe("Custom");
    expect(describeScoring({ ...SCORING_PRESETS.half_ppr, pointsPerReception: 0.6 })).toBe("Custom");
    expect(describeScoring({ ...SCORING_PRESETS.ppr, teReceptionBonus: 0.25 })).toBe("Custom");
    expect(describeScoring({ ...SCORING_PRESETS.te_premium, teReceptionBonus: 1 })).toBe("Custom");
  });
});
