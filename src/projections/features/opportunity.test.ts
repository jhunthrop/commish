import { describe, expect, it } from "vitest";
import {
  rollingOpportunity,
  snapShare,
  targetShare,
  targetsPerRouteRun,
  OPPORTUNITY_CONFIG,
} from "./opportunity";

describe("snapShare", () => {
  it("is the player's snaps over his offense's", () => {
    expect(snapShare(41, 62)).toBeCloseTo(0.6613, 4);
  });

  it("is 1 for a man who never left the field", () => {
    expect(snapShare(62, 62)).toBe(1);
  });

  it("answers null, not NaN, when the offense ran no snaps", () => {
    // A real week: a team that turned the ball over on its first snap of a weather game, or a
    // player-week row that exists with no game behind it. 0/0 is unknown, and unknown is null.
    expect(snapShare(0, 0)).toBeNull();
  });

  it("is zero — real knowledge, not absence — for a man who dressed and never played a snap", () => {
    expect(snapShare(0, 62)).toBe(0);
  });

  it("refuses a negative count", () => {
    expect(() => snapShare(-1, 62)).toThrow(/negative/i);
  });

  it("refuses a player with more snaps than his offense ran", () => {
    expect(() => snapShare(63, 62)).toThrow(/more.*than/i);
  });

  it("refuses a non-finite input rather than passing NaN downstream", () => {
    expect(() => snapShare(Number.NaN, 62)).toThrow(/finite/i);
  });
});

describe("targetShare", () => {
  it("is the player's targets over his team's", () => {
    expect(targetShare(6, 30)).toBe(0.2);
  });

  it("answers null when the team threw the ball nowhere", () => {
    expect(targetShare(0, 0)).toBeNull();
  });
});

describe("targetsPerRouteRun", () => {
  it("is targets over routes", () => {
    expect(targetsPerRouteRun(6, 30)).toBe(0.2);
  });

  it("answers null when routes run is unknown — the value we never have", () => {
    expect(targetsPerRouteRun(6, null)).toBeNull();
  });

  it("answers null when he ran no routes", () => {
    expect(targetsPerRouteRun(0, 0)).toBeNull();
  });
});

describe("rollingOpportunity", () => {
  const history = [
    { week: 1, value: 0.2 },
    { week: 2, value: 0.4 },
    { week: 3, value: 0.9 },
  ];

  it("weights the most recent week most heavily", () => {
    const rolled = rollingOpportunity(history, { window: 3 })!;
    const flat = (0.2 + 0.4 + 0.9) / 3;
    expect(rolled).toBeGreaterThan(flat);
  });

  it("is exactly the value when there is only one week to weigh", () => {
    expect(rollingOpportunity([{ week: 7, value: 0.55 }], { window: 4 })).toBe(0.55);
  });

  it("weighs by how long ago a week was, not by how many rows separate it", () => {
    // A player who missed weeks 5 and 6 should have his week-4 form discounted by three weeks of
    // absence, not treated as though it were last week. Counting rows would do the latter.
    const returning = rollingOpportunity([{ week: 4, value: 0.9 }, { week: 7, value: 0.3 }], { window: 4 })!;
    const continuous = rollingOpportunity([{ week: 6, value: 0.9 }, { week: 7, value: 0.3 }], { window: 4 })!;
    expect(returning).toBeLessThan(continuous);
  });

  it("looks back only as far as the window", () => {
    const long = [...history, { week: 10, value: 0.1 }];
    expect(rollingOpportunity(long, { window: 1 })).toBe(0.1);
  });

  it("skips a week with no value rather than counting it as zero", () => {
    // A bye is not a week of no opportunity, it is a week with no evidence. Averaging a zero in
    // would halve a starter's projected share for the crime of having a bye.
    const withBye = [{ week: 5, value: 0.7 }, { week: 6, value: null }, { week: 7, value: 0.7 }];
    expect(rollingOpportunity(withBye, { window: 3 })).toBeCloseTo(0.7, 10);
  });

  it("answers null when nothing in the window has a value", () => {
    expect(rollingOpportunity([{ week: 1, value: null }], { window: 3 })).toBeNull();
    expect(rollingOpportunity([], { window: 3 })).toBeNull();
  });

  it("does not care what order the history arrives in", () => {
    const shuffled = [history[2]!, history[0]!, history[1]!];
    expect(rollingOpportunity(shuffled, { window: 3 })).toBe(rollingOpportunity(history, { window: 3 }));
  });

  it("refuses a window that is not a positive whole number of weeks", () => {
    expect(() => rollingOpportunity(history, { window: 0 })).toThrow(/window/i);
    expect(() => rollingOpportunity(history, { window: 2.5 })).toThrow(/window/i);
  });

  it("refuses a decay outside (0, 1] — outside it the arithmetic stops being a weighted mean", () => {
    expect(() => rollingOpportunity(history, { window: 3, decay: 0 })).toThrow(/decay/i);
    expect(() => rollingOpportunity(history, { window: 3, decay: 1.5 })).toThrow(/decay/i);
  });

  it("collapses to a flat mean at a decay of 1", () => {
    expect(rollingOpportunity(history, { window: 3, decay: 1 })).toBeCloseTo((0.2 + 0.4 + 0.9) / 3, 10);
  });

  it("has a default decay the config states, so nobody has to guess it at a call site", () => {
    expect(rollingOpportunity(history, { window: 3 })).toBe(
      rollingOpportunity(history, { window: 3, decay: OPPORTUNITY_CONFIG.recencyDecay }),
    );
  });
});
