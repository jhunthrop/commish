import { describe, expect, it } from "vitest";
import type { TeamBoardPlayer } from "../contract";
import { rosterMetaLine } from "./roster-section";

function row(overrides: Partial<TeamBoardPlayer>): TeamBoardPlayer {
  return {
    player: { id: "p1", name: "Jahmyr Gibbs", position: "RB", nflTeam: "DET", headshotUrl: null, adp: null },
    positionRank: 2,
    boardRank: 5,
    projectedPoints: 248.3,
    marketAdp: 2.5,
    tier: 0,
    rosterStatus: null,
    ...overrides,
  };
}

describe("rosterMetaLine", () => {
  it("leads with the roster status when the board stored one, the same short word the pill shows", () => {
    const status = { status: "injured_reserve" as const, source: "tank01_player_list" as const, observedAt: "2026-09-05T22:35:00.000Z", team: "DET", excluded: false };
    expect(rosterMetaLine(row({ rosterStatus: status }))).toBe("IR · Board 5 · Tier S · ADP 2.5 · 248.3 pts");
    const squad = { ...status, status: "practice_squad" as const, excluded: true };
    expect(rosterMetaLine(row({ rosterStatus: squad, boardRank: null, tier: null, projectedPoints: null }))).toBe("Practice squad · ADP 2.5");
  });

  it("prints the board's own tier letter, never the store's zero-based index", () => {
    expect(rosterMetaLine(row({ tier: 0 }))).toBe("Board 5 · Tier S · ADP 2.5 · 248.3 pts");
    expect(rosterMetaLine(row({ tier: 1 }))).toBe("Board 5 · Tier A · ADP 2.5 · 248.3 pts");
    expect(rosterMetaLine(row({ tier: 3 }))).toBe("Board 5 · Tier C · ADP 2.5 · 248.3 pts");
  });

  it("drops each fact the board does not state", () => {
    expect(rosterMetaLine(row({ boardRank: null, tier: null, projectedPoints: null }))).toBe("ADP 2.5");
    expect(rosterMetaLine(row({ boardRank: null, tier: null, projectedPoints: null, marketAdp: null }))).toBe("");
  });
});
