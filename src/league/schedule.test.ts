import { describe, it, expect } from "vitest";
import type { Matchup } from "@/domain/schedule";
import { LEAGUE_CONFIG } from "./config";
import { currentWeekNumber, generateSchedule } from "./schedule";

const teamIds = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

function okSchedule(n: number, weeks: number) {
  const result = generateSchedule({ leagueId: "L", teamIds: teamIds(n), weeks });
  if (!result.ok) throw new Error(result.reason);
  return result;
}

/** How many weeks the rotation takes to come back around: `n - 1` for an even league, `n` for an odd one. */
const cycleLength = (n: number) => (n % 2 === 0 ? n - 1 : n);

const pairKey = (m: Matchup) => [m.homeTeamId, m.awayTeamId].sort().join("|");
const pairsOfWeek = (matchups: readonly Matchup[], week: number) =>
  matchups.filter((m) => m.weekNumber === week).map(pairKey).sort();

describe("generateSchedule", () => {
  it("produces a valid 12-team, 14-week season", () => {
    const { weeks, matchups } = okSchedule(12, 14);
    expect(weeks).toHaveLength(14);
    expect(weeks[0]).toEqual({ leagueId: "L", weekNumber: 1 });
    expect(matchups).toHaveLength(14 * 6);
    for (let week = 1; week <= 14; week++) {
      const ofWeek = matchups.filter((m) => m.weekNumber === week);
      expect(ofWeek).toHaveLength(6);
      const playing = ofWeek.flatMap((m) => [m.homeTeamId, m.awayTeamId]);
      // Everybody plays, and nobody plays twice.
      expect(new Set(playing).size).toBe(12);
      expect(ofWeek.every((m) => m.homeTeamId !== m.awayTeamId)).toBe(true);
      expect(ofWeek.every((m) => m.homeScore === null && m.awayScore === null)).toBe(true);
      expect(ofWeek.every((m) => m.leagueId === "L")).toBe(true);
    }
  });

  it("plays every distinct pairing once before repeating any", () => {
    const { matchups } = okSchedule(12, 11);
    const pairs = matchups.map(pairKey);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("gives each team a bye when the league has an odd number of teams", () => {
    const { matchups } = okSchedule(5, 5);
    expect(matchups).toHaveLength(5 * 2);
    const byes = new Map<string, number>();
    for (let week = 1; week <= 5; week++) {
      const playing = new Set(matchups.filter((m) => m.weekNumber === week).flatMap((m) => [m.homeTeamId, m.awayTeamId]));
      expect(playing.size).toBe(4);
      for (const id of teamIds(5)) if (!playing.has(id)) byes.set(id, (byes.get(id) ?? 0) + 1);
    }
    expect([...byes.values()]).toEqual([1, 1, 1, 1, 1]);
    expect(matchups.some((m) => m.homeTeamId === "BYE" || m.awayTeamId === "BYE")).toBe(false);
  });

  it("wraps the rotation when the season is longer than one full round robin", () => {
    const { matchups } = okSchedule(4, 6);
    expect(pairsOfWeek(matchups, 4)).toEqual(pairsOfWeek(matchups, 1));
  });

  it("balances home and away across the season", () => {
    const { matchups } = okSchedule(12, 14);
    for (const id of teamIds(12)) {
      const home = matchups.filter((m) => m.homeTeamId === id).length;
      const away = matchups.filter((m) => m.awayTeamId === id).length;
      expect(Math.abs(home - away)).toBeLessThanOrEqual(2);
    }
  });

  it("is deterministic", () => {
    expect(okSchedule(10, 13)).toEqual(okSchedule(10, 13));
  });

  it("rejects the inputs it cannot schedule, in plain language", () => {
    expect(generateSchedule({ leagueId: "L", teamIds: ["t1"], weeks: 4 })).toEqual({
      ok: false,
      reason: "A league needs at least two teams before we can build a schedule.",
    });
    expect(generateSchedule({ leagueId: "L", teamIds: ["t1", "t1"], weeks: 4 })).toEqual({
      ok: false,
      reason: "Every team may appear only once.",
    });
    expect(generateSchedule({ leagueId: "L", teamIds: teamIds(4), weeks: 0 })).toEqual({
      ok: false,
      reason: "A season needs at least one week.",
    });
    expect(generateSchedule({ leagueId: "L", teamIds: teamIds(4), weeks: LEAGUE_CONFIG.maxWeeks + 1 })).toEqual({
      ok: false,
      reason: `A season can run for at most ${LEAGUE_CONFIG.maxWeeks} weeks.`,
    });
  });
});

/**
 * The circle method is easy to write subtly wrong, and a wrong one only shows up as a league
 * where somebody plays twice in a week or never gets a bye. These loops assert the four
 * invariants for every league size the product allows, over a season long enough to cross the
 * rotation's wrap point — the boundary the hand-written cases above cannot all reach.
 */
describe("round-robin invariants, for every league size", () => {
  for (let teamCount = 2; teamCount <= LEAGUE_CONFIG.maxTeams; teamCount++) {
    const cycle = cycleLength(teamCount);
    const weeks = Math.min(cycle + 2, LEAGUE_CONFIG.maxWeeks);
    const gamesPerWeek = Math.floor(teamCount / 2);

    it(`holds for ${teamCount} teams over ${weeks} weeks`, () => {
      const { weeks: weekRows, matchups } = okSchedule(teamCount, weeks);
      const ids = teamIds(teamCount);
      expect(weekRows.map((w) => w.weekNumber)).toEqual(Array.from({ length: weeks }, (_, i) => i + 1));
      expect(matchups).toHaveLength(weeks * gamesPerWeek);
      expect(matchups.some((m) => m.homeTeamId === "BYE" || m.awayTeamId === "BYE")).toBe(false);

      // 1. Nobody plays twice in a week, and everybody who is not on a bye plays.
      const byes = new Map<string, number>(ids.map((id) => [id, 0]));
      for (let week = 1; week <= weeks; week++) {
        const ofWeek = matchups.filter((m) => m.weekNumber === week);
        expect(ofWeek).toHaveLength(gamesPerWeek);
        const playing = ofWeek.flatMap((m) => [m.homeTeamId, m.awayTeamId]);
        expect(new Set(playing).size).toBe(gamesPerWeek * 2);
        if (week <= cycle) {
          for (const id of ids) if (!playing.includes(id)) byes.set(id, byes.get(id)! + 1);
        }
      }

      // 2. Over one full cycle every team sits out exactly as often as every other team.
      const expectedByes = teamCount % 2 === 0 ? 0 : 1;
      expect([...byes.values()]).toEqual(ids.map(() => expectedByes));

      // 3. No pairing repeats before the cycle is complete — one full round robin, then again.
      const firstCycle = matchups.filter((m) => m.weekNumber <= cycle).map(pairKey);
      expect(new Set(firstCycle).size).toBe(firstCycle.length);
      expect(firstCycle).toHaveLength((teamCount * (teamCount - 1)) / 2);

      // 4. Past the wrap point the rotation repeats cycle-aligned, not arbitrarily.
      for (let week = 1; week + cycle <= weeks; week++) {
        expect(pairsOfWeek(matchups, week + cycle)).toEqual(pairsOfWeek(matchups, week));
      }
    });
  }
});

describe("currentWeekNumber", () => {
  const matchup = (weekNumber: number, scored: boolean): Matchup => ({
    leagueId: "L", weekNumber, homeTeamId: "t1", awayTeamId: "t2",
    homeScore: scored ? 100 : null, awayScore: scored ? 90 : null,
  });

  it("is the first week that has not been scored", () => {
    expect(currentWeekNumber([matchup(1, true), matchup(2, true), matchup(3, false)], 14)).toBe(3);
  });

  it("is week one when nothing has been scored, or when there is no schedule at all", () => {
    expect(currentWeekNumber([matchup(1, false)], 14)).toBe(1);
    expect(currentWeekNumber([], 14)).toBe(1);
  });

  it("treats a half-scored matchup as unfinished", () => {
    const halfScored: Matchup = { ...matchup(2, true), awayScore: null };
    expect(currentWeekNumber([matchup(1, true), halfScored], 14)).toBe(2);
  });

  it("stops at the last week once the whole season is scored", () => {
    expect(currentWeekNumber([matchup(1, true), matchup(2, true)], 2)).toBe(2);
  });
});
