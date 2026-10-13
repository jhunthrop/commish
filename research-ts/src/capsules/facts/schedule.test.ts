import { describe, expect, it } from "vitest";
import { scheduleFor, type ScheduledGame } from "./schedule";

const games: readonly ScheduledGame[] = [
  { week: 1, homeTeam: "NYG", awayTeam: "DAL" },
  { week: 2, homeTeam: "PHI", awayTeam: "NYG" },
  { week: 15, homeTeam: "PHI", awayTeam: "NYG" },
  { week: 16, homeTeam: "NYG", awayTeam: "WAS" },
  { week: 4, homeTeam: "DAL", awayTeam: "PHI" },
];

describe("scheduleFor", () => {
  it("reports the opener, the home and road split and the fantasy playoff fixtures", () => {
    expect(scheduleFor("NYG", games, new Map([[1, false], [2, false], [15, false], [16, true]]))).toEqual({
      weekOneOpponent: { week: 1, opponent: "DAL", home: true },
      homeGames: 2,
      roadGames: 2,
      indoorGames: 1,
      playoffWeeks: [
        { week: 15, opponent: "PHI", home: false },
        { week: 16, opponent: "WAS", home: true },
      ],
    });
  });

  it("reports an absent indoors reading as absent rather than as zero indoor games", () => {
    expect(scheduleFor("NYG", games, new Map())!.indoorGames).toBeNull();
  });

  it("reports a real zero when the store says every game is outdoors", () => {
    expect(scheduleFor("NYG", games, new Map([[1, false]]))!.indoorGames).toBe(0);
  });

  it("leaves the opener absent when the published schedule holds no week one for him", () => {
    expect(scheduleFor("WAS", games, new Map())!.weekOneOpponent).toBeNull();
  });

  it("returns nothing at all for a team the schedule store holds no game for", () => {
    expect(scheduleFor("SEA", games, new Map())).toBeNull();
  });
});
