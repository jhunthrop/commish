import { describe, expect, it } from "vitest";
import type { BoardRow } from "@research-ts/board/service";
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
    overallTier: null,
    overallPlayersLeftInTier: null,
    overallDropToNextTier: null,
    marketAdp: null,
    marketPositionAdp: null,
    byeWeek: null,
    reasons: [],
    rosterStatus: null,
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
      rosterStatus: null,
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

  it("carries the board's roster status onto the result, and a band row stays findable with no board rank", () => {
    const reserve = row({ playerId: "p7", name: "Reserve Back", position: "RB", team: "KC", ...PROJECTED, overallRank: 40, rosterStatus: { status: "injured_reserve", source: "tank01_player_list", observedAt: "2026-09-05T22:35:00.000Z", team: "KC", excluded: false } });
    const squad = row({ playerId: "p8", name: "Squad Back", position: "RB", team: "NO", rosterStatus: { status: "practice_squad", source: "nflverse_roster_week_1", observedAt: "2026-09-01T00:00:00.000Z", team: "NO", excluded: true } });
    const entries = searchEntriesFor([reserve, squad], [], new Map());
    const results = entries.map((entry) => entry.result).filter((result) => result.kind === "player");
    expect(results.find((result) => result.player.id === "p7")?.rosterStatus).toEqual(reserve.rosterStatus);
    const band = results.find((result) => result.player.id === "p8");
    expect(band?.rosterStatus?.excluded).toBe(true);
    expect(band?.boardRank).toBeNull();
    expect(band?.positionRank).toBeNull();
  });
});
