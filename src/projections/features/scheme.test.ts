import { describe, expect, it } from "vitest";
import { COACH_METRICS } from "../nflverse/coaches";
import { PBP_METRICS } from "../nflverse/pbp";
import type { TeamMetricLookup } from "../team-context";
import { schemeEstimate, schemeRatios, type SchemeLeagueMeans } from "./scheme";

const LEAGUE: SchemeLeagueMeans = { paceSecondsPerPlay: 32.6, passRate: 0.552, passRateOverExpected: -1.74 };

/** A lookup where a season's weeks all carry the same value, so a test states only what varies. */
function lookupOf(bySeason: Readonly<Record<number, Readonly<Record<string, number>>>>): TeamMetricLookup {
  return (_team, at, metric) => bySeason[at.season]?.[metric] ?? null;
}

const BASE = { team: "PHI", season: 2024, metrics: (() => null) as TeamMetricLookup, league: LEAGUE, lastPossibleWeek: 18 };

describe("schemeEstimate", () => {
  it("moves this season's measurement toward the prior season, not all the way to it", () => {
    const estimate = schemeEstimate({
      ...BASE,
      week: 5,
      metrics: lookupOf({ 2023: { [PBP_METRICS.passRate]: 0.5 }, 2024: { [PBP_METRICS.passRate]: 0.7 } }),
    });
    expect(estimate.passRate!).toBeGreaterThan(0.5);
    expect(estimate.passRate!).toBeLessThan(0.7);
  });

  it("falls back to the prior season in week 1, where no in-season evidence exists", () => {
    const estimate = schemeEstimate({
      ...BASE,
      week: 1,
      metrics: lookupOf({ 2023: { [PBP_METRICS.passRate]: 0.62 } }),
    });
    // Shrunk toward the league by the season-prior weight, so between the team's 0.62 and 0.552.
    expect(estimate.passRate!).toBeGreaterThan(LEAGUE.passRate);
    expect(estimate.passRate!).toBeLessThan(0.62);
  });

  it("discards the team's own history when the play-caller is new, and uses HIS", () => {
    // The whole point of the coaching-change prior. Last season's tendencies belonged to a man who
    // no longer works here.
    const withChange = schemeEstimate({
      ...BASE,
      week: 1,
      metrics: lookupOf({
        2023: { [PBP_METRICS.paceSecondsPerPlay]: 40 },
        2024: { [COACH_METRICS.tenureSeasons]: 0, [COACH_METRICS.priorPace]: 26 },
      }),
    });
    const withoutChange = schemeEstimate({
      ...BASE,
      week: 1,
      metrics: lookupOf({
        2023: { [PBP_METRICS.paceSecondsPerPlay]: 40 },
        2024: { [COACH_METRICS.tenureSeasons]: 3 },
      }),
    });
    expect(withChange.coachingChange).toBe(true);
    expect(withChange.paceSecondsPerPlay).toBe(26);
    expect(withoutChange.coachingChange).toBe(false);
    expect(withoutChange.paceSecondsPerPlay!).toBeGreaterThan(LEAGUE.paceSecondsPerPlay);
  });

  it("falls back to the league for a first-time coach we have no history of", () => {
    // Not to the team he is replacing. A new coach with no record is an unknown, and the team's own
    // last season is a claim about somebody else.
    const estimate = schemeEstimate({
      ...BASE,
      week: 1,
      metrics: lookupOf({
        2023: { [PBP_METRICS.paceSecondsPerPlay]: 40 },
        2024: { [COACH_METRICS.tenureSeasons]: 0 },
      }),
    });
    expect(estimate.paceSecondsPerPlay).toBe(LEAGUE.paceSecondsPerPlay);
  });

  it("answers null where nothing at all is known, so a caller falls back rather than guessing", () => {
    const estimate = schemeEstimate({ ...BASE, week: 5 });
    expect(estimate.paceSecondsPerPlay).toBeNull();
    expect(estimate.passRate).toBeNull();
  });

  it("never reads the week it is predicting", () => {
    const seen: number[] = [];
    schemeEstimate({
      ...BASE,
      week: 5,
      metrics: (_team, at, metric) => {
        if (at.season === 2024 && metric === PBP_METRICS.passRate) seen.push(at.week);
        return null;
      },
    });
    expect(seen).toEqual([1, 2, 3, 4]);
  });
});

describe("schemeRatios", () => {
  it("inverts pace, so a tempo above 1 means a faster offence and not a slower one", () => {
    // Pace is SECONDS per play. The single easiest sign error in this feature, done once here so
    // that every consumer can read `tempo > 1` as faster.
    const fast = schemeRatios({ paceSecondsPerPlay: 26, passRate: null, passRateOverExpected: null, coachingChange: false }, LEAGUE);
    const slow = schemeRatios({ paceSecondsPerPlay: 38, passRate: null, passRateOverExpected: null, coachingChange: false }, LEAGUE);
    expect(fast.tempo!).toBeGreaterThan(1);
    expect(slow.tempo!).toBeLessThan(1);
  });

  it("reports a pass-leaning offence above 1", () => {
    const ratios = schemeRatios({ paceSecondsPerPlay: null, passRate: 0.62, passRateOverExpected: null, coachingChange: false }, LEAGUE);
    expect(ratios.passLean!).toBeGreaterThan(1);
  });
});
