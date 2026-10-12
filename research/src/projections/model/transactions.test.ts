import { describe, expect, it } from "vitest";
import type { Position } from "@research/domain/player";
import type { PlayerWeekTeam } from "../team-store";
import type { PlayerWeekUsage } from "../usage";
import { detectTransactions, TRANSACTION_CONFIG } from "./transactions";

const AS_OF = new Date("2024-10-15T12:00:00.000Z");

const POSITIONS: ReadonlyMap<string, Position> = new Map([
  ["cooper", "WR"],
  ["jeudy", "WR"],
  ["tillman", "WR"],
  ["njoku", "TE"],
]);

const SNAPS: ReadonlyMap<string, number> = new Map([
  ["jeudy", 0.9],
  ["tillman", 0.45],
  ["njoku", 0.75],
]);

function usageRow(playerId: string, week: number, targetShare: number): PlayerWeekUsage {
  return {
    season: 2024,
    week,
    playerId,
    snapShare: 0.8,
    targetShare,
    carryShare: 0,
    passAttemptShare: 0,
    targets: targetShare * 35,
    carries: 0,
    passAttempts: 0,
    teamTargets: 35,
    teamCarries: 25,
    teamPassAttempts: 35,
    touches: null,
    asOf: AS_OF,
  };
}

function edge(playerId: string, week: number, team: string): PlayerWeekTeam {
  return { season: 2024, week, playerId, team, asOf: AS_OF };
}

/** Cleveland's weeks 1-6, then weeks 7-8 without Cooper, who has been traded to Buffalo. */
function browns(throughWeek: number, cooperGoneFrom: number, cooperTo: string | null) {
  const usage: PlayerWeekUsage[] = [];
  const teams: PlayerWeekTeam[] = [];
  for (let week = 1; week <= throughWeek; week += 1) {
    const cooperHere = week < cooperGoneFrom;
    if (cooperHere) {
      usage.push(usageRow("cooper", week, 0.21));
      teams.push(edge("cooper", week, "CLE"));
    } else if (cooperTo !== null) {
      usage.push(usageRow("cooper", week, 0.2));
      teams.push(edge("cooper", week, cooperTo));
    }
    for (const [playerId, share] of [["jeudy", 0.19], ["tillman", 0.09], ["njoku", 0.14]] as const) {
      usage.push(usageRow(playerId, week, share));
      teams.push(edge(playerId, week, "CLE"));
    }
  }
  return { usage, playerTeams: teams, positions: POSITIONS, snapShares: SNAPS };
}

describe("detectTransactions", () => {
  it("sees the trade the week after it is played, and not before", () => {
    // The engine reads no transaction wire. A trade becomes knowable on the Sunday a man takes a
    // snap for somebody else, which is later than a human knows it and is the earliest this data
    // can honestly say it.
    const beforeAnyGame = detectTransactions(browns(6, 7, "BUF"));
    const afterOneGame = detectTransactions(browns(7, 7, "BUF"));
    expect(beforeAnyGame.find((row) => row.team === "CLE")).toBeUndefined();
    expect(afterOneGame.find((row) => row.team === "CLE")!.departures.map((move) => move.playerId)).toEqual(["cooper"]);
  });

  it("carries the share he was taking, not a guess at it", () => {
    const cleveland = detectTransactions(browns(7, 7, "BUF")).find((row) => row.team === "CLE")!;
    expect(cleveland.departures[0]!.targetShare).toBeCloseTo(0.21, 6);
  });

  it("leaves the remaining roster behind, with the departing player excluded from it", () => {
    const cleveland = detectTransactions(browns(7, 7, "BUF")).find((row) => row.team === "CLE")!;
    expect(cleveland.roster.map((player) => player.playerId).sort()).toEqual(["jeudy", "njoku", "tillman"]);
  });

  it("treats a man who simply stopped playing as a departure — a release and an injury look alike", () => {
    // The feature does not need to know which it was, and distinguishing them from snap counts
    // would be inventing a fact. A RELEASE takes one game longer to see than a trade, and that
    // asymmetry is real rather than a defect: a trade is proved by the snap he takes somewhere
    // else, while a release is only ever proved by an absence, and one missed game is a healthy
    // scratch.
    expect(detectTransactions(browns(7, 7, null)).find((row) => row.team === "CLE")).toBeUndefined();
    const afterTwoMissed = detectTransactions(browns(8, 7, null)).find((row) => row.team === "CLE")!;
    expect(afterTwoMissed.departures.map((move) => move.playerId)).toEqual(["cooper"]);
  });

  it("records the arrival on the team that gained him, so his share compresses theirs", () => {
    const buffalo = detectTransactions(browns(7, 7, "BUF")).find((row) => row.team === "BUF");
    expect(buffalo!.arrivals.map((move) => move.playerId)).toEqual(["cooper"]);
  });

  it("stops treating a departure as news once layer 1 has had games to learn it", () => {
    // By the third game after a trade the model has seen the new distribution twice and does not
    // need telling. Applying a correction then would be a correction on top of a correction.
    const stale = detectTransactions(browns(7 + TRANSACTION_CONFIG.relevantForTeamGames + 1, 7, "BUF"));
    expect(stale.find((row) => row.team === "CLE")?.departures ?? []).toEqual([]);
  });

  it("ignores a departure too small to be worth redistributing", () => {
    const input = browns(7, 7, "BUF");
    const trivial = {
      ...input,
      usage: input.usage.map((row) => (row.playerId === "cooper" ? { ...row, targetShare: 0.03 } : row)),
    };
    expect(detectTransactions(trivial).find((row) => row.team === "CLE")).toBeUndefined();
  });

  it("ignores a man who had barely been there, whose share says nothing about the offence", () => {
    const usage = [usageRow("cooper", 6, 0.21), ...browns(7, 1, null).usage];
    const teams = [edge("cooper", 6, "CLE"), ...browns(7, 1, null).playerTeams];
    const detected = detectTransactions({ usage, playerTeams: teams, positions: POSITIONS, snapShares: SNAPS });
    expect(detected.find((row) => row.team === "CLE")).toBeUndefined();
  });
});
