import { describe, expect, it } from "vitest";
import type { BoardRow } from "@/draft-hq/board/service";
import { searchEntriesFor } from "./entries";

function row(overrides: Partial<BoardRow> & Pick<BoardRow, "playerId" | "name" | "position" | "team">): BoardRow {
  return {
    nflPlayerId: `nfl-${overrides.playerId}`,
    headshotUrl: null,
    rank: null,
    overallRank: null,
    projectedPoints: null,
    floorPoints: null,
    medianPoints: null,
    ceilingPoints: null,
    marketOrderRank: null,
    lastSeason: null,
    valueOverReplacement: null,
    valueRank: null,
    positionRankInValue: null,
    tier: null,
    playersLeftInTier: null,
    dropToNextTier: null,
    marketAdp: null,
    marketPositionAdp: null,
    byeWeek: null,
    reasons: [],
    ...overrides,
  };
}

const PROJECTED = { rank: 1, projectedPoints: 300, floorPoints: 200, medianPoints: 290, ceilingPoints: 380 };
const CHASE = row({ playerId: "p1", name: "Ja'Marr Chase", position: "WR", team: "CIN", ...PROJECTED, overallRank: 1, positionRankInValue: 1, marketAdp: 1.2, byeWeek: 10, headshotUrl: "https://a.espncdn.com/x.png" });
const GIBBS = row({ playerId: "p2", name: "Jahmyr Gibbs", position: "RB", team: "DET", ...PROJECTED, rank: 3, overallRank: 3, positionRankInValue: 2, byeWeek: 8 });
const LIONS_DEF = row({ playerId: "DST-DET", name: "Detroit Lions", position: "DEF", team: "DET", marketOrderRank: 4, marketAdp: 150.2, byeWeek: 8 });

describe("searchEntriesFor", () => {
  const entries = searchEntriesFor([CHASE, GIBBS, LIONS_DEF], ["CIN", "DET"], new Map([["DET", 8], ["CIN", 10]]));

  it("makes one player entry per board row, in board order, carrying the row's facts", () => {
    const players = entries.filter((entry) => entry.result.kind === "player");
    expect(players.map((entry) => entry.result.kind === "player" && entry.result.player.name)).toEqual(["Ja'Marr Chase", "Jahmyr Gibbs", "Detroit Lions"]);
    const [chase] = players;
    expect(chase!.result).toEqual({
      kind: "player",
      player: { id: "p1", name: "Ja'Marr Chase", position: "WR", nflTeam: "CIN", headshotUrl: "https://a.espncdn.com/x.png", adp: 1.2 },
      positionRank: 1,
      boardRank: 1,
      byeWeek: 10,
    });
    expect(chase!.fields).toEqual({ name: "jamarr chase", team: ["cin", "cincinnati", "bengals"], position: "wr" });
  });

  it("gives a market-order row its market place as the position rank and no board rank", () => {
    const def = entries.find((entry) => entry.result.kind === "player" && entry.result.player.id === "DST-DET")!;
    expect(def.result).toMatchObject({ positionRank: 4, boardRank: null });
  });

  it("makes one team entry per code, named by city and nickname, with the code among its name words", () => {
    const teams = entries.filter((entry) => entry.result.kind === "team");
    expect(teams.map((entry) => entry.result.kind === "team" && entry.result.name)).toEqual(["Cincinnati Bengals", "Detroit Lions"]);
    expect(teams[1]!.fields).toEqual({ name: "detroit lions det", team: [], position: null });
    expect(teams[1]!.result).toEqual({ kind: "team", code: "DET", name: "Detroit Lions", byeWeek: 8 });
  });

  it("orders ties by the served board: projected rows, then teams, then market-order rows", () => {
    const orderOf = (id: string) => entries.find((entry) => (entry.result.kind === "player" ? entry.result.player.id : entry.result.code) === id)!.order;
    expect(orderOf("p1")).toBeLessThan(orderOf("p2"));
    expect(orderOf("p2")).toBeLessThan(orderOf("DET"));
    expect(orderOf("DET")).toBeLessThan(orderOf("DST-DET"));
  });

  it("skips a team code the name table does not hold rather than inventing a name", () => {
    const withUnknown = searchEntriesFor([], ["ZZZ", "DET"], new Map());
    expect(withUnknown.map((entry) => entry.result.kind === "team" && entry.result.code)).toEqual(["DET"]);
  });
});
