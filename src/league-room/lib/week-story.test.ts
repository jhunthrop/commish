import { describe, expect, it } from "vitest";
import type { MatchupDetail, MatchupWeekBody } from "../contract";
import { MATCHUP, STANDINGS } from "../test-fixtures";
import { weekStoryFor, type WeekStoryInput } from "./week-story";

/** A slate around `MATCHUP` (t1 vs t2, final, 112.50 to 98.25) — overridden per case. */
function week(overrides: Partial<MatchupWeekBody>): MatchupWeekBody {
  return {
    leagueId: "l1",
    weekNumber: 3,
    totalWeeks: 14,
    myTeamId: "t3",
    matchups: [MATCHUP],
    weekStatus: "scheduled",
    gamesFinal: 0,
    gamesTotal: 16,
    ...overrides,
  };
}

function input(overrides: Partial<WeekStoryInput>): WeekStoryInput {
  return { week: week({}), hasMyMatchup: false, standings: STANDINGS, regularSeasonWeeks: 14, ...overrides };
}

/** `MATCHUP` reopened: playoff pairings still to play. */
const UNPLAYED: MatchupDetail = {
  ...MATCHUP,
  final: false,
  weekStatus: "scheduled",
  home: { ...MATCHUP.home, score: null },
  away: { ...MATCHUP.away, score: null },
};

describe("weekStoryFor", () => {
  it("answers matchup whenever the viewer has one", () => {
    expect(weekStoryFor(input({ hasMyMatchup: true }))).toEqual({ kind: "matchup" });
  });

  it("answers playoffs-out for a playoff week the viewer is not in, with the real pairings and the round's name", () => {
    const story = weekStoryFor(input({ week: week({ weekNumber: 16, totalWeeks: 16, matchups: [UNPLAYED] }) }));
    expect(story).toEqual({ kind: "playoffs-out", roundLabel: "Semifinals", weekNumber: 16, matchups: [UNPLAYED] });
  });

  it("names each playoff round by the bracket's own week arithmetic", () => {
    const at = (weekNumber: number) => weekStoryFor(input({ week: week({ weekNumber, totalWeeks: weekNumber + 1, matchups: [UNPLAYED] }) }));
    expect(at(15)).toMatchObject({ roundLabel: "First round" });
    expect(at(17)).toMatchObject({ roundLabel: "Championship" });
  });

  it("answers season-over with the championship winner once the final playoff week is a single settled game", () => {
    const story = weekStoryFor(input({ week: week({ weekNumber: 17, totalWeeks: 17 }) }));
    expect(story).toEqual({ kind: "season-over", champion: "Bay Bandits", finalWeek: 17 });
  });

  it("season-over outranks the viewer's own settled matchup — the wrap card is the story, even for the finalists", () => {
    const story = weekStoryFor(input({ hasMyMatchup: true, week: week({ weekNumber: 17, totalWeeks: 17 }) }));
    expect(story).toMatchObject({ kind: "season-over" });
  });

  it("gives a tied championship to the better regular-season rank, the bracket engine's own convention", () => {
    const tied: MatchupDetail = { ...MATCHUP, home: { ...MATCHUP.home, score: 100 }, away: { ...MATCHUP.away, score: 100 } };
    const story = weekStoryFor(input({ week: week({ weekNumber: 17, totalWeeks: 17, matchups: [tied] }) }));
    // t1 (rank 1, home) over t2 (rank 2).
    expect(story).toMatchObject({ kind: "season-over", champion: "Bay Bandits" });
  });

  it("claims no champion for a season that ended without a provable bracket final", () => {
    // A regular-season final week (weekNumber at the regular-season boundary): champion stays
    // null and the renderer falls back to first-place language, never championship language.
    const story = weekStoryFor(input({ week: week({ weekNumber: 14, totalWeeks: 14 }) }));
    expect(story).toEqual({ kind: "season-over", champion: null, finalWeek: 14 });
  });

  it("collapses honestly to quiet-week when the playoff boundary is unknown", () => {
    const story = weekStoryFor(input({ regularSeasonWeeks: null, week: week({ weekNumber: 16, totalWeeks: 16, matchups: [UNPLAYED] }) }));
    expect(story).toEqual({ kind: "quiet-week", weekNumber: 16, matchups: [UNPLAYED] });
  });

  it("answers quiet-week for a regular-season week the viewer sits out", () => {
    const story = weekStoryFor(input({ week: week({ matchups: [UNPLAYED] }) }));
    expect(story).toEqual({ kind: "quiet-week", weekNumber: 3, matchups: [UNPLAYED] });
  });

  it("answers none when no slate loaded at all", () => {
    expect(weekStoryFor(input({ week: null }))).toEqual({ kind: "none" });
    expect(weekStoryFor(input({ week: week({ matchups: [] }) }))).toEqual({ kind: "none" });
  });
});
