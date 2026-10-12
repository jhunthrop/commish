import { describe, expect, it } from "vitest";
import { STAT_FIELDS } from "@research/domain/player";
import { PPR_SCORING } from "@research/domain/scoring";
import { computeFantasyPoints } from "@research/scoring/compute";
import { RATES, type PlayerRates, type RateName } from "./efficiency";
import { composeStatLine, predictedVolume } from "./compose";
import type { PredictedOpportunity } from "./opportunity";

function rates(over: Partial<Record<RateName, number>>): PlayerRates {
  return { ...(Object.fromEntries(Object.keys(RATES).map((name) => [name, 0])) as PlayerRates), ...over };
}

const RECEIVER: PredictedOpportunity = {
  playerId: "wr",
  snapShare: 0.85,
  targetShare: 0.25,
  carryShare: 0,
  passAttemptShare: 0,
  teamTargets: 36,
  teamCarries: 26,
  teamPassAttempts: 36,
};

describe("predictedVolume", () => {
  it("turns each share into the count it implies", () => {
    // The number worth arguing with: "we think he sees nine targets" is a claim a manager can
    // check, and a receiving-yards total three multiplications deep is not.
    expect(predictedVolume(RECEIVER).targets).toBeCloseTo(9, 10);
    expect(predictedVolume(RECEIVER).carries).toBeCloseTo(0, 10);
  });
});

describe("composeStatLine", () => {
  it("multiplies volume by rate, and nothing else", () => {
    const line = composeStatLine("wr", 7, RECEIVER, rates({
      receptionsPerTarget: 0.65,
      receivingYardsPerTarget: 8,
      receivingTouchdownsPerTarget: 0.05,
    }));
    expect(line.receptions).toBeCloseTo(9 * 0.65, 10);
    expect(line.receivingYards).toBeCloseTo(9 * 8, 10);
    expect(line.receivingTouchdowns).toBeCloseTo(9 * 0.05, 10);
    expect(line.week).toBe(7);
  });

  it("charges fumbles against every play, not against one kind of them", () => {
    // nflverse splits a lost fumble across sack, rushing and receiving columns and `stat-lines.ts`
    // sums them into one field. The projection has to be taken over the same denominator or the
    // two are not the same quantity.
    const dualThreat: PredictedOpportunity = { ...RECEIVER, carryShare: 0.2, passAttemptShare: 0.5 };
    const line = composeStatLine("qb", 3, dualThreat, rates({ fumblesLostPerPlay: 0.01 }));
    const volume = predictedVolume(dualThreat);
    expect(line.fumblesLost).toBeCloseTo(0.01 * (volume.targets + volume.carries + volume.passAttempts), 10);
  });

  it("leaves the fields Phase 2 does not model at exactly zero", () => {
    const line = composeStatLine("wr", 1, RECEIVER, rates({ receivingYardsPerTarget: 8 }));
    expect(line).toMatchObject({
      fieldGoalsMade: 0,
      extraPointsMade: 0,
      sacks: 0,
      defensiveInterceptions: 0,
      defensiveTouchdowns: 0,
    });
  });

  it("emits a finite number for every stat field a StatLine carries", () => {
    // A NaN here would sail through composition and land in `metrics.ts`, which throws a thousand
    // rows into a replay with nothing pointing back at the layer that produced it.
    const line = composeStatLine("wr", 1, RECEIVER, rates({ receivingYardsPerTarget: 8 }));
    for (const field of STAT_FIELDS) expect(Number.isFinite(line[field])).toBe(true);
  });

  it("scores through the league's real rules, never a hardcoded sum", () => {
    // The whole reason a projection is a StatLine rather than a number of points: the same
    // predicted line is worth more in a league that pays for receptions, and the composition never
    // has to know that.
    const line = composeStatLine("wr", 1, RECEIVER, rates({ receptionsPerTarget: 0.65, receivingYardsPerTarget: 8 }));
    const ppr = computeFantasyPoints(line, "WR", PPR_SCORING);
    const standard = computeFantasyPoints(line, "WR", { ...PPR_SCORING, pointsPerReception: 0 });
    expect(ppr - standard).toBeCloseTo(9 * 0.65 * PPR_SCORING.pointsPerReception, 6);
  });

  it("pays a tight end the league's tight-end bonus without being told he is one", () => {
    const line = composeStatLine("te", 1, RECEIVER, rates({ receptionsPerTarget: 0.65 }));
    const rules = { ...PPR_SCORING, teReceptionBonus: 0.5 };
    // To one decimal, because `computeFantasyPoints` rounds each total to the product's two places
    // before the subtraction — 2.925 lands as 2.93, and asserting past that would be asserting
    // against the rounding rather than against the bonus.
    expect(computeFantasyPoints(line, "TE", rules) - computeFantasyPoints(line, "WR", rules)).toBeCloseTo(9 * 0.65 * 0.5, 1);
  });
});
