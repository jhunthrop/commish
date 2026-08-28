import { describe, expect, it } from "vitest";
import { CONTINUITY_METRICS } from "../nflverse/team-map";
import { PBP_METRICS } from "../nflverse/pbp";
import type { TeamMetricLookup, WeekRef } from "../team-context";
import { LINE_CONFIG, lineComposite, lineConfidence, lineWindow, type LineLeagueMeans } from "./line";

const LEAGUE: LineLeagueMeans = { adjustedLineYards: 2.5, stuffedRate: 0.185, sackRateAllowed: 0.063 };

/** A lookup over a flat table of `metric -> value per week`, so a test states only what it varies. */
function lookupOf(values: Readonly<Record<string, number>>): TeamMetricLookup {
  return (_team, _at, metric) => values[metric] ?? null;
}

const FOUR_WEEKS: readonly WeekRef[] = [1, 2, 3, 4].map((week) => ({ season: 2024, week }));

describe("lineWindow", () => {
  it("reads this season's completed weeks and not the offseason before them", () => {
    // A line is substantially rebuilt every offseason. Measured on the fit seasons, a composite
    // built from this season alone correlates with next-week team rushing at roughly twice the
    // strength of one blended across January.
    expect(lineWindow(2024, 5, 22)).toEqual([1, 2, 3, 4].map((week) => ({ season: 2024, week })));
  });

  it("falls back to the whole prior season in week 1, because the alternative is nothing at all", () => {
    const window = lineWindow(2024, 1, 22);
    expect(window).toHaveLength(22);
    expect(window.every((week) => week.season === 2023)).toBe(true);
  });
});

describe("lineConfidence", () => {
  it("trusts a line that started the same five in full", () => {
    expect(lineConfidence(5)).toBeCloseTo(LINE_CONFIG.settledWeight, 10);
  });

  it("floors a line that changed all five, rather than erasing everything the offence is", () => {
    expect(lineConfidence(0)).toBeCloseTo(LINE_CONFIG.minimumWeight, 10);
  });

  it("treats an unknown continuity as the least settled case", () => {
    // Absent is not "settled". A team with no continuity rows has not proved a stable line.
    expect(lineConfidence(null)).toBeCloseTo(LINE_CONFIG.minimumWeight, 10);
  });
});

describe("lineComposite", () => {
  it("reports a line better than the league above 1 and a worse one below it", () => {
    const better = lineComposite({
      team: "PHI",
      weeks: FOUR_WEEKS,
      metrics: lookupOf({
        [PBP_METRICS.adjustedLineYards]: 3.2,
        [PBP_METRICS.stuffedRate]: 0.13,
        [CONTINUITY_METRICS.sameStarters]: 5,
      }),
      league: LEAGUE,
    });
    const worse = lineComposite({
      team: "CAR",
      weeks: FOUR_WEEKS,
      metrics: lookupOf({
        [PBP_METRICS.adjustedLineYards]: 1.9,
        [PBP_METRICS.stuffedRate]: 0.25,
        [CONTINUITY_METRICS.sameStarters]: 5,
      }),
      league: LEAGUE,
    });
    expect(better.runBlocking!).toBeGreaterThan(1);
    expect(worse.runBlocking!).toBeLessThan(1);
  });

  it("inverts the stuffed rate, so both halves of run blocking point the same way", () => {
    // The easiest thing in this file to get backwards. A LOW stuffed rate is a GOOD line, and a
    // composite that averaged it raw would have the two halves cancelling each other out.
    const stuffedOnly = (rate: number) =>
      lineComposite({
        team: "PHI",
        weeks: FOUR_WEEKS,
        metrics: lookupOf({ [PBP_METRICS.stuffedRate]: rate, [CONTINUITY_METRICS.sameStarters]: 5 }),
        league: LEAGUE,
      }).runBlocking!;
    expect(stuffedOnly(0.12)).toBeGreaterThan(stuffedOnly(0.28));
  });

  it("inverts the sack rate for pass protection, for the same reason", () => {
    const protectionOf = (rate: number) =>
      lineComposite({
        team: "PHI",
        weeks: FOUR_WEEKS,
        metrics: lookupOf({ [PBP_METRICS.sackRateAllowed]: rate, [CONTINUITY_METRICS.sameStarters]: 5 }),
        league: LEAGUE,
      }).passProtection!;
    expect(protectionOf(0.03)).toBeGreaterThan(protectionOf(0.11));
  });

  it("pulls an unsettled line back toward the league — instability is uncertainty, not badness", () => {
    const of = (sameStarters: number) =>
      lineComposite({
        team: "PHI",
        weeks: FOUR_WEEKS,
        metrics: lookupOf({
          [PBP_METRICS.adjustedLineYards]: 3.2,
          [CONTINUITY_METRICS.sameStarters]: sameStarters,
        }),
        league: LEAGUE,
      }).runBlocking!;
    const settled = of(5);
    const churning = of(1);
    expect(settled).toBeGreaterThan(churning);
    // Damped toward 1, never past it: a good line that changed a man is still a good line.
    expect(churning).toBeGreaterThan(1);
  });

  it("shrinks a single week of evidence hard toward the league", () => {
    const oneWeek = lineComposite({
      team: "PHI",
      weeks: [{ season: 2024, week: 1 }],
      metrics: (_team, at, metric) =>
        at.week === 1 && metric === PBP_METRICS.adjustedLineYards ? 5 : metric === CONTINUITY_METRICS.sameStarters ? 5 : null,
      league: LEAGUE,
    });
    const fourWeeks = lineComposite({
      team: "PHI",
      weeks: FOUR_WEEKS,
      metrics: lookupOf({ [PBP_METRICS.adjustedLineYards]: 5, [CONTINUITY_METRICS.sameStarters]: 5 }),
      league: LEAGUE,
    });
    expect(fourWeeks.runBlocking!).toBeGreaterThan(oneWeek.runBlocking!);
  });

  it("answers null where it has no evidence, so a caller falls back rather than assuming the worst line", () => {
    const nothing = lineComposite({ team: "PHI", weeks: FOUR_WEEKS, metrics: () => null, league: LEAGUE });
    expect(nothing.runBlocking).toBeNull();
    expect(nothing.passProtection).toBeNull();
  });
});
