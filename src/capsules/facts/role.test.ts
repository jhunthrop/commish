import { describe, expect, it } from "vitest";
import { roleTrendFor, targetCompetitionFor, type PlayerWeekShare } from "./role";

const week = (n: number, snapShare: number | null, targetShare: number | null = null): PlayerWeekShare => ({ week: n, snapShare, targetShare });

describe("roleTrendFor", () => {
  it("splits the first four readings against the last four and names both windows", () => {
    expect(roleTrendFor(2025, [1, 2, 3, 4, 5, 6, 7, 8].map((n) => week(n, n / 10)))).toEqual({
      season: 2025,
      earlyWeeks: [1, 2, 3, 4],
      lateWeeks: [5, 6, 7, 8],
      snapShare: { early: 0.25, late: 0.65 },
      targetShare: null,
    });
  });

  it("names the weeks he actually has readings for, not weeks one through four", () => {
    const trend = roleTrendFor(2025, [6, 7, 8, 9, 14, 15, 16, 17].map((n) => week(n, 0.5)));
    expect(trend).toMatchObject({ earlyWeeks: [6, 7, 8, 9], lateWeeks: [14, 15, 16, 17] });
  });

  it("refuses a split it cannot make without overlapping windows", () => {
    expect(roleTrendFor(2025, [1, 2, 3].map((n) => week(n, 0.5)))).toBeNull();
  });

  it("refuses a metric whose late window carries no real reading rather than comparing against nothing", () => {
    const weeks = [week(1, 0.4, 0.2), week(2, 0.4, 0.2), week(3, 0.4, 0.2), week(4, 0.4, 0.2), week(5, 0.8, null), week(6, 0.8, null), week(7, 0.8, null), week(8, 0.8, null)];
    expect(roleTrendFor(2025, weeks)).toMatchObject({ snapShare: { early: 0.4, late: 0.8 }, targetShare: null });
  });

  it("sorts weeks the store handed back out of order before splitting them", () => {
    const shuffled = [8, 3, 5, 1, 7, 2, 6, 4].map((n) => week(n, n / 10));
    expect(roleTrendFor(2025, shuffled)).toMatchObject({ earlyWeeks: [1, 2, 3, 4], lateWeeks: [5, 6, 7, 8] });
  });
});

describe("targetCompetitionFor", () => {
  const names = new Map([
    ["a", "Ja'Marr Chase"],
    ["b", "Tee Higgins"],
    ["c", "Andrei Iosivas"],
  ]);

  it("names the two biggest earners and adds their shares", () => {
    const competition = targetCompetitionFor(
      2025,
      "CIN",
      [
        { playerId: "c", targets: 60, teamTargets: 600 },
        { playerId: "a", targets: 180, teamTargets: 600 },
        { playerId: "b", targets: 120, teamTargets: 600 },
      ],
      names,
    );
    expect(competition).toEqual({
      season: 2025,
      team: "CIN",
      leaders: [
        { name: "Ja'Marr Chase", share: 0.3 },
        { name: "Tee Higgins", share: 0.2 },
      ],
      combinedShare: 0.5,
    });
  });

  it("refuses a team with fewer than two real earners rather than calling one man a competition", () => {
    expect(targetCompetitionFor(2025, "CIN", [{ playerId: "a", targets: 180, teamTargets: 600 }], names)).toBeNull();
  });

  it("never divides by a team-target count the store does not hold", () => {
    expect(
      targetCompetitionFor(
        2025,
        "CIN",
        [
          { playerId: "a", targets: 180, teamTargets: 0 },
          { playerId: "b", targets: 120, teamTargets: 0 },
        ],
        names,
      ),
    ).toBeNull();
  });
});
