import type { TeamPageData } from "./contract";

/** A club the store holds nothing about beyond its name: every section absent. */
export const EMPTY_TEAM: TeamPageData = {
  code: "TEN",
  city: "Tennessee",
  nickname: "Titans",
  byeWeek: null,
  season: 2026,
  lastSeason: null,
  winTotal: null,
  coaching: null,
  offense: null,
  players: [],
  depthCharts: null,
  competition: null,
  schedule: null,
  defense: null,
};

/** A club with every section the store can hold. */
export const FULL_TEAM: TeamPageData = {
  code: "DET",
  city: "Detroit",
  nickname: "Lions",
  byeWeek: 8,
  season: 2026,
  lastSeason: { season: 2025, record: { wins: 15, losses: 2, ties: 0 }, pointsAllowed: { points: 341, games: 17 } },
  winTotal: { season: 2026, line: 10.5, asOf: "2026-08-15" },
  coaching: { season: 2026, headCoach: "Dan Campbell", headCoachIsNew: false, playCaller: "John Morton", playCallerRole: "OC", playCallerIsNew: true },
  offense: { season: 2025, pace: { value: 27.1, rank: 9, of: 32 }, passRate: { value: 0.582, rank: 12, of: 32 }, passRateOverExpected: { value: 2.4, rank: 11, of: 32 }, neutralPlays: 512 },
  players: [
    { player: { id: "4429795", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", headshotUrl: null, adp: 4.1 }, positionRank: 2, boardRank: 3, projectedPoints: 312.4, marketAdp: 4.1, tier: 1, rosterStatus: null },
    { player: { id: "4374302", name: "Amon-Ra St. Brown", position: "WR", nflTeam: "DET", headshotUrl: null, adp: 8.6 }, positionRank: 3, boardRank: 7, projectedPoints: 288, marketAdp: 8.6, tier: 1, rosterStatus: null },
    { player: { id: "DST-DET", name: "Detroit Lions", position: "DEF", nflTeam: "DET", headshotUrl: null, adp: 150.2 }, positionRank: 4, boardRank: null, projectedPoints: null, marketAdp: 150.2, tier: null, rosterStatus: null },
  ],
  depthCharts: {
    season: 2026,
    release: { asOf: "2026-08-28", groups: [{ position: "RB", slots: [{ slot: 1, name: "Jahmyr Gibbs", playerId: "4429795" }, { slot: 2, name: "Isiah Pacheco", playerId: "4361529" }] }] },
    // Altmyer is listed by the harvest and unknown to the universe: named, never linked.
    harvest: { asOf: "2026-09-05", groups: [{ position: "QB", slots: [{ slot: 1, name: "Jared Goff", playerId: "3046779" }, { slot: 2, name: "Luke Altmyer", playerId: null }] }] },
  },
  competition: {
    season: 2025,
    targets: [{ nflPlayerId: "asb", playerId: "4374302", name: "Amon-Ra St. Brown", count: 150, share: 0.27 }],
    // Montgomery has no crosswalk row: named in the table, never linked.
    carries: [
      { nflPlayerId: "gib", playerId: "4429795", name: "Jahmyr Gibbs", count: 250, share: 0.54 },
      { nflPlayerId: "mont", playerId: null, name: "David Montgomery", count: 158, share: 0.37 },
    ],
    redZoneTouches: [{ nflPlayerId: "gib", playerId: "4429795", name: "Jahmyr Gibbs", count: 41 }],
  },
  schedule: {
    weekOneOpponent: { week: 1, opponent: "NO", home: true },
    homeGames: 9,
    roadGames: 8,
    indoorGames: null,
    playoffWeeks: [
      { week: 15, opponent: "PIT", home: false },
      { week: 16, opponent: "MIN", home: true },
      { week: 17, opponent: "CHI", home: false },
    ],
  },
  defense: {
    season: 2025,
    playerId: "DST-DET",
    points: 125.8,
    games: 17,
    pointsPerGame: 7.4,
    facts: {
      kind: "DEF",
      sacks: 43,
      interceptions: 14,
      fumbleRecoveries: 9,
      takeaways: 23,
      defensiveTouchdowns: 3,
      specialTeamsTouchdowns: 1,
      safeties: 1,
      yardsAllowed: 5400,
      gamesWithYardsAllowed: 17,
      pointsAllowed: 341,
      gamesWithPointsAllowed: 17,
      pointsAllowedBandGames: [],
    },
    adpRank: 4,
    scoringLabel: "PPR",
  },
};
