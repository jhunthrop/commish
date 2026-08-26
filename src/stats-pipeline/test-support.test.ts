import { describe, expect, it } from "vitest";
import type { Player, StatLine } from "@/domain/player";
import { describeStatsProviderContract } from "@/stats/test-support";
import { fakeStatsProvider, type FakeStatsProviderScript } from "./test-support";

const LINE: StatLine = {
  playerId: "p1",
  week: 1,
  passingYards: 0,
  passingTouchdowns: 0,
  interceptions: 0,
  rushingYards: 0,
  rushingTouchdowns: 0,
  receivingYards: 0,
  receivingTouchdowns: 0,
  receptions: 0,
  fumblesLost: 0,
  fieldGoalsMade: 0,
  extraPointsMade: 0,
  sacks: 0,
  defensiveInterceptions: 0,
  defensiveTouchdowns: 0,
};

describe("fakeStatsProvider", () => {
  it("listPlayers answers the scripted roster, or an empty list when none was scripted", async () => {
    const scripted = fakeStatsProvider({ players: [{ id: "p1", name: "A Player", position: "WR", nflTeam: "SF", headshotUrl: null }], games: {} });
    await expect(scripted.listPlayers()).resolves.toEqual([{ id: "p1", name: "A Player", position: "WR", nflTeam: "SF", headshotUrl: null }]);

    const unscripted = fakeStatsProvider({ games: {} });
    await expect(unscripted.listPlayers()).resolves.toEqual([]);
  });

  it("getGameStatLines answers a scripted game's lines, or an empty list for an unknown game", async () => {
    const game = { gameId: "g1", week: 1, status: "final" as const, homeNflTeam: "SF", awayNflTeam: "SEA" };
    const provider = fakeStatsProvider({ games: { 1: [{ ...game, lines: [LINE] }] } });

    await expect(provider.getGameStatLines(game)).resolves.toEqual([LINE]);
    await expect(provider.getGameStatLines({ ...game, gameId: "unknown-game" })).resolves.toEqual([]);
  });

  it("getWeeklyStatLines flattens every scripted game's lines for that week", async () => {
    const otherLine: StatLine = { ...LINE, playerId: "p2" };
    const provider = fakeStatsProvider({
      games: {
        1: [
          { gameId: "g1", week: 1, status: "final", homeNflTeam: "SF", awayNflTeam: "SEA", lines: [LINE] },
          { gameId: "g2", week: 1, status: "final", homeNflTeam: "DAL", awayNflTeam: "NYG", lines: [otherLine] },
        ],
      },
    });

    await expect(provider.getWeeklyStatLines(1)).resolves.toEqual([LINE, otherLine]);
    await expect(provider.getWeeklyStatLines(2)).resolves.toEqual([]);
  });

  it("listAdp answers the scripted entries, or an empty list when none were scripted", async () => {
    const scripted = fakeStatsProvider({ games: {}, adp: [{ playerId: "p1", adp: 3.5 }] });
    await expect(scripted.listAdp()).resolves.toEqual([{ playerId: "p1", adp: 3.5 }]);

    const unscripted = fakeStatsProvider({ games: {} });
    await expect(unscripted.listAdp()).resolves.toEqual([]);
  });
});

/**
 * A representative script for the contract suite below: every position including DEF, two games
 * in week 1 (one final, so the "identical on a second read" case has something to read), and each
 * game's lines drawn only from that game's own two teams.
 */
const CONTRACT_PLAYERS: readonly Player[] = [
  { id: "qb_sf", name: "A Quarterback", position: "QB", nflTeam: "SF", headshotUrl: null },
  { id: "rb_sf", name: "A Running Back", position: "RB", nflTeam: "SF", headshotUrl: null },
  { id: "wr_sea", name: "A Receiver", position: "WR", nflTeam: "SEA", headshotUrl: null },
  { id: "te_sea", name: "A Tight End", position: "TE", nflTeam: "SEA", headshotUrl: null },
  { id: "k_kc", name: "A Kicker", position: "K", nflTeam: "KC", headshotUrl: null },
  { id: "def_den", name: "DEN Defense", position: "DEF", nflTeam: "DEN", headshotUrl: null },
];

const CONTRACT_SCRIPT: FakeStatsProviderScript = {
  players: CONTRACT_PLAYERS,
  lastWeekOfSeason: 2,
  // Listed players only, each once, every value positive and finite — the three ADP laws the
  // contract now asserts. DEF included: the real feed ranks team defenses too.
  adp: [
    { playerId: "rb_sf", adp: 1.6 },
    { playerId: "wr_sea", adp: 2.5 },
    { playerId: "qb_sf", adp: 11.4 },
    { playerId: "def_den", adp: 152.9 },
  ],
  games: {
    1: [
      {
        gameId: "g_sf_sea",
        week: 1,
        status: "final",
        homeNflTeam: "SEA",
        awayNflTeam: "SF",
        lines: [
          { ...LINE, playerId: "qb_sf", passingYards: 240, passingTouchdowns: 2 },
          { ...LINE, playerId: "rb_sf", rushingYards: -3 },
          { ...LINE, playerId: "wr_sea", receptions: 6, receivingYards: 88 },
          { ...LINE, playerId: "te_sea", receptions: 2 },
        ],
      },
      {
        gameId: "g_kc_den",
        week: 1,
        status: "in_progress",
        homeNflTeam: "DEN",
        awayNflTeam: "KC",
        lines: [
          { ...LINE, playerId: "k_kc", fieldGoalsMade: 2, extraPointsMade: 3 },
          { ...LINE, playerId: "def_den", sacks: 3, defensiveInterceptions: 1 },
        ],
      },
    ],
    2: [
      {
        gameId: "g_sf_kc",
        week: 2,
        status: "final",
        homeNflTeam: "KC",
        awayNflTeam: "SF",
        lines: [{ ...LINE, playerId: "qb_sf", week: 2, passingYards: 310 }],
      },
    ],
  },
};

// The fake is a THIRD `StatsProvider` implementation, and every worker test is written against
// its semantics — so it has to obey the same laws the mock and the Tank01 adapter do, or those
// tests prove the worker correct against a provider that cannot exist. Bound to the same suite,
// not exempted from it.
describeStatsProviderContract("FakeStatsProvider", () => fakeStatsProvider(CONTRACT_SCRIPT));
