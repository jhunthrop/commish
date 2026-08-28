import { describe, expect, it } from "vitest";
import type { ProjectionInput } from "../backtest";
import { applyNewsToOpportunity, type ContextPriors } from "../model/context";
import { NO_FEATURES } from "../model/features";
import type { PredictedOpportunity } from "../model/opportunity";
import { emptyTeamContext } from "../team-context";
import type { PlayerWeekObservation } from "../store";
import {
  acceptAdjustment,
  applyNews,
  newsAdjustments,
  weighedMultiplier,
  ADJUSTABLE_COMPONENT,
  NEWS_MULTIPLIER_BOUND,
  type NewsAdjustment,
  type NewsPriors,
} from "./adjust";
import { INJURY_METRICS, INJURY_SOURCE, PRACTICE_STATUS, REPORT_STATUS } from "./retrieve";

const FILED = new Date("2024-09-20T19:00:00.000Z");
const PROJECTING_AT = new Date("2024-09-21T12:00:00.000Z");

function adjustment(over: Partial<NewsAdjustment> = {}): NewsAdjustment {
  return {
    playerId: "back",
    component: ADJUSTABLE_COMPONENT,
    multiplier: 0.2,
    confidence: 0.9,
    expiresAt: new Date("2024-09-30T19:00:00.000Z"),
    citation: { source: INJURY_SOURCE, metric: INJURY_METRICS.reportStatus, season: 2024, week: 3, filedAt: FILED },
    ...over,
  };
}

function opportunity(playerId: string, share: number): PredictedOpportunity {
  return {
    playerId,
    snapShare: share,
    targetShare: share,
    carryShare: share,
    passAttemptShare: share,
    teamTargets: 33,
    teamCarries: 26,
    teamPassAttempts: 33,
  };
}

/**
 * THE CONTRACT TESTS. These were written before the implementation and they matter more than the
 * feature does: in a product where entry fees ride on the output, an invented injury is unacceptable.
 */
describe("acceptAdjustment — the refusals", () => {
  it("rejects an adjustment with no citation", () => {
    // The unforgivable one. A number nobody can trace to a publication is a number somebody made up,
    // whether or not they meant to.
    const uncited = { ...adjustment(), citation: undefined } as unknown as NewsAdjustment;
    expect(acceptAdjustment(uncited, PROJECTING_AT)).toEqual({ accepted: false, refusal: "uncited" });
  });

  it("rejects a citation that names no source", () => {
    const blank = adjustment({ citation: { ...adjustment().citation, source: "  " } });
    expect(acceptAdjustment(blank, PROJECTING_AT)).toEqual({ accepted: false, refusal: "uncited" });
  });

  it("rejects a citation with no filing time, because 'when' is half of a citation", () => {
    const undated = adjustment({ citation: { ...adjustment().citation, filedAt: new Date("nonsense") } });
    expect(acceptAdjustment(undated, PROJECTING_AT)).toEqual({ accepted: false, refusal: "uncited" });
  });

  it("stops applying an expired adjustment", () => {
    // An injury report is published about ONE game. Stale evidence that keeps applying is how a
    // returning starter stays benched by a model forever.
    const stale = adjustment({ expiresAt: new Date("2024-09-21T00:00:00.000Z") });
    expect(acceptAdjustment(stale, PROJECTING_AT)).toEqual({ accepted: false, refusal: "expired" });
  });

  it("judges expiry against the moment being projected, never against the wall clock", () => {
    // A backtest replaying October 2023 must apply exactly the adjustments that were live then. A
    // `Date.now()` inside the contract would leave every historical projection with an empty news
    // layer and today's with a full one.
    const live = adjustment({ expiresAt: new Date("2024-09-22T00:00:00.000Z") });
    expect(acceptAdjustment(live, PROJECTING_AT).accepted).toBe(true);
    expect(acceptAdjustment(live, new Date("2025-01-01T00:00:00.000Z")).accepted).toBe(false);
  });

  it("refuses a multiplier above the bound", () => {
    const runaway = adjustment({ multiplier: NEWS_MULTIPLIER_BOUND.max + 0.01 });
    expect(acceptAdjustment(runaway, PROJECTING_AT)).toEqual({ accepted: false, refusal: "out_of_bounds" });
  });

  it("refuses a multiplier below the bound, and a non-number", () => {
    expect(acceptAdjustment(adjustment({ multiplier: -0.1 }), PROJECTING_AT)).toEqual({ accepted: false, refusal: "out_of_bounds" });
    expect(acceptAdjustment(adjustment({ multiplier: Number.NaN }), PROJECTING_AT)).toEqual({ accepted: false, refusal: "out_of_bounds" });
  });

  it("allows exactly zero, because a man ruled out takes no snaps at all", () => {
    // The bound is asymmetric on purpose. A floor that could not express "he is not playing" would
    // be useless for the one case the layer exists for.
    expect(acceptAdjustment(adjustment({ multiplier: 0 }), PROJECTING_AT).accepted).toBe(true);
  });

  it("refuses a confidence outside (0, 1]", () => {
    expect(acceptAdjustment(adjustment({ confidence: 0 }), PROJECTING_AT)).toEqual({ accepted: false, refusal: "bad_confidence" });
    expect(acceptAdjustment(adjustment({ confidence: 1.5 }), PROJECTING_AT)).toEqual({ accepted: false, refusal: "bad_confidence" });
  });

  it("refuses an adjustment aimed at anything but opportunity", () => {
    // A layer that can set a component value outright can invent one, and the layer beneath it stops
    // being measurable. A hurt man gets fewer snaps; he does not become worse at catching.
    const wrong = { ...adjustment(), component: "efficiency" } as unknown as NewsAdjustment;
    expect(acceptAdjustment(wrong, PROJECTING_AT)).toEqual({ accepted: false, refusal: "wrong_component" });
  });
});

describe("weighedMultiplier", () => {
  it("pulls the multiplier toward doing nothing as confidence falls", () => {
    expect(weighedMultiplier(adjustment({ multiplier: 0, confidence: 1 }))).toBeCloseTo(0, 10);
    expect(weighedMultiplier(adjustment({ multiplier: 0, confidence: 0.5 }))).toBeCloseTo(0.5, 10);
    expect(weighedMultiplier(adjustment({ multiplier: 0.5, confidence: 0.5 }))).toBeCloseTo(0.75, 10);
  });
});

describe("applyNews", () => {
  const shares = new Map([
    ["back", opportunity("back", 0.5)],
    ["other", opportunity("other", 0.5)],
  ]);

  it("scales all four of a player's shares by the same factor and leaves everyone else alone", () => {
    // Availability is not selective: a man who does not play takes no snaps, targets, carries or
    // throws. Scaling one and not the others would be a claim about how his role changes when hurt.
    const result = applyNews(shares, [adjustment({ multiplier: 0, confidence: 1 })], PROJECTING_AT);
    const back = result.opportunity.get("back")!;
    expect([back.snapShare, back.targetShare, back.carryShare, back.passAttemptShare]).toEqual([0, 0, 0, 0]);
    expect(result.opportunity.get("other")).toEqual(shares.get("other"));
    expect(result.applied).toBe(1);
  });

  it("never touches the team volumes, because his offence still runs its plays", () => {
    const result = applyNews(shares, [adjustment({ multiplier: 0, confidence: 1 })], PROJECTING_AT);
    const back = result.opportunity.get("back")!;
    expect(back.teamTargets).toBe(33);
    expect(back.teamCarries).toBe(26);
    expect(back.teamPassAttempts).toBe(33);
  });

  it("counts every refusal by kind and applies none of them", () => {
    const result = applyNews(
      shares,
      [
        { ...adjustment(), citation: undefined } as unknown as NewsAdjustment,
        adjustment({ expiresAt: new Date("2024-09-01T00:00:00.000Z") }),
        adjustment({ multiplier: 9 }),
        adjustment({ confidence: 2 }),
      ],
      PROJECTING_AT,
    );
    expect(result.applied).toBe(0);
    expect(result.refused).toEqual({ uncited: 1, expired: 1, out_of_bounds: 1, bad_confidence: 1, wrong_component: 0 });
    expect(result.opportunity).toBe(shares);
  });

  it("composes two adjustments for one player rather than letting the last one win", () => {
    // The store returns rows in an order chosen for reproducibility rather than for meaning, so the
    // application has to be order-free.
    const result = applyNews(
      shares,
      [adjustment({ multiplier: 0.5, confidence: 1 }), adjustment({ multiplier: 0.5, confidence: 1 })],
      PROJECTING_AT,
    );
    expect(result.opportunity.get("back")!.snapShare).toBeCloseTo(0.125, 10);
  });
});

describe("newsAdjustments — deriving from the store, generating nothing", () => {
  const PRIORS: NewsPriors = {
    reportStatus: {
      [String(REPORT_STATUS.questionable)]: { multiplier: 0.9, confidence: 0.5 },
      [String(REPORT_STATUS.out)]: { multiplier: 0, confidence: 1 },
    },
    practiceStatus: {
      [String(PRACTICE_STATUS.didNotParticipate)]: { multiplier: 0.6, confidence: 0.4 },
    },
    validityHours: 240,
  };

  function observation(metric: string, value: number, playerId = "back"): PlayerWeekObservation {
    return { season: 2024, week: 3, playerId, source: INJURY_SOURCE, metric, value, asOf: FILED };
  }

  it("cites the exact row every adjustment came from", () => {
    const [made] = newsAdjustments([observation(INJURY_METRICS.reportStatus, REPORT_STATUS.out)], PRIORS);
    expect(made!.citation).toEqual({
      source: INJURY_SOURCE,
      metric: INJURY_METRICS.reportStatus,
      season: 2024,
      week: 3,
      filedAt: FILED,
    });
    expect(made!.multiplier).toBe(0);
  });

  it("expires an adjustment a fixed window after the publisher filed it", () => {
    const [made] = newsAdjustments([observation(INJURY_METRICS.reportStatus, REPORT_STATUS.out)], PRIORS);
    expect(made!.expiresAt.getTime()).toBe(FILED.getTime() + 240 * 3_600_000);
  });

  it("prefers the game status over the practice status, because they are not independent evidence", () => {
    // A Friday "Out" is the league's conclusion FROM the week's practice. Applying both would
    // multiply one fact by itself.
    const made = newsAdjustments(
      [
        observation(INJURY_METRICS.reportStatus, REPORT_STATUS.out),
        observation(INJURY_METRICS.practiceStatus, PRACTICE_STATUS.didNotParticipate),
      ],
      PRIORS,
    );
    expect(made).toHaveLength(1);
    expect(made[0]!.citation.metric).toBe(INJURY_METRICS.reportStatus);
  });

  it("falls back to the practice status when no game status has been published", () => {
    const made = newsAdjustments([observation(INJURY_METRICS.practiceStatus, PRACTICE_STATUS.didNotParticipate)], PRIORS);
    expect(made).toHaveLength(1);
    expect(made[0]!.multiplier).toBe(0.6);
  });

  it("makes no adjustment for a player merely listed with no designation", () => {
    const made = newsAdjustments(
      [
        observation(INJURY_METRICS.reportStatus, REPORT_STATUS.none),
        observation(INJURY_METRICS.practiceStatus, PRACTICE_STATUS.none),
      ],
      PRIORS,
    );
    expect(made).toEqual([]);
  });

  it("makes no adjustment for a designation the fit never measured", () => {
    // Falling back to a guessed multiplier would be the model generating a fact rather than
    // weighing one, which is the whole thing this layer is forbidden to do.
    const made = newsAdjustments([observation(INJURY_METRICS.reportStatus, REPORT_STATUS.doubtful)], PRIORS);
    expect(made).toEqual([]);
  });

  it("ignores rows from any feed but the one it names", () => {
    const foreign = { ...observation(INJURY_METRICS.reportStatus, REPORT_STATUS.out), source: "somebody_elses_wire" };
    expect(newsAdjustments([foreign], PRIORS)).toEqual([]);
  });
});

describe("applyNewsToOpportunity — the seam the ablation switches", () => {
  const shares = new Map([["back", opportunity("back", 0.5)]]);
  const PRIORS: NewsPriors = {
    reportStatus: { [String(REPORT_STATUS.out)]: { multiplier: 0, confidence: 1 } },
    practiceStatus: {},
    validityHours: 240,
  };
  const news: PlayerWeekObservation[] = [
    { season: 2024, week: 3, playerId: "back", source: INJURY_SOURCE, metric: INJURY_METRICS.reportStatus, value: REPORT_STATUS.out, asOf: FILED },
  ];
  const input = {
    season: 2024,
    week: 3,
    asOf: PROJECTING_AT,
    history: [],
    usage: [],
    positions: new Map(),
    teamContext: emptyTeamContext,
    news,
  } as unknown as ProjectionInput;
  const context = { news: PRIORS } as unknown as ContextPriors;

  it("returns the very same map when the flag is off, so an ablation's before arm is the model without it", () => {
    // Identity rather than deep equality on purpose: the `before` arm of an ablation has to be the
    // model without the feature, not a copy of it that happens to hold the same numbers.
    expect(applyNewsToOpportunity(shares, input, { ...NO_FEATURES }, context)).toBe(shares);
  });

  it("applies a cited, unexpired, in-bounds adjustment when the flag is on", () => {
    const adjusted = applyNewsToOpportunity(shares, input, { ...NO_FEATURES, news: true }, context);
    expect(adjusted.get("back")!.snapShare).toBe(0);
  });

  it("judges expiry against the projection's own moment, not the wall clock", () => {
    const late = { ...input, asOf: new Date("2025-01-01T00:00:00.000Z") } as ProjectionInput;
    expect(applyNewsToOpportunity(shares, late, { ...NO_FEATURES, news: true }, context).get("back")!.snapShare).toBe(0.5);
  });
});
