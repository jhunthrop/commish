import { describe, expect, it } from "vitest";
import type { TradeProposalView } from "@/trades/contract";
import type { TradeRosterPlayer } from "../contract";
import { tradeSheetMath, type TradeMathInput } from "./trade-math";

const player = (
  playerId: string,
  name: string,
  position: TradeRosterPlayer["position"],
  nflTeam: string,
): TradeRosterPlayer => ({ playerId, name, position, nflTeam, headshotUrl: null, adp: null });

const MY_ROSTER: readonly TradeRosterPlayer[] = [
  player("wr-asb", "Amon-Ra St. Brown", "WR", "DET"),
  player("wr-2", "Puka Nacua", "WR", "LAR"),
  player("rb-1", "James Cook", "RB", "BUF"),
];

const THEIR_ROSTER: readonly TradeRosterPlayer[] = [
  player("rb-gibbs", "Jahmyr Gibbs", "RB", "DET"),
  player("qb-1", "Josh Allen", "QB", "BUF"),
];

// River Hogs (t2) offer Gibbs for my St. Brown; I am t1, the counterparty.
const TRADE: TradeProposalView = {
  id: "trade-1",
  leagueId: "league-1",
  weekNumber: 2,
  status: "open",
  proposedAt: "2026-09-15T12:00:00.000Z",
  expiresAt: "2026-09-18T21:00:00.000Z",
  settledAt: null,
  reversedAt: null,
  note: null,
  from: { teamId: "t2", teamName: "River Hogs", assets: [{ kind: "player", playerId: "rb-gibbs" }] },
  to: { teamId: "t1", teamName: "Your Team", assets: [{ kind: "player", playerId: "wr-asb" }] },
};

const INPUT: TradeMathInput = {
  trade: TRADE,
  meTeamId: "t1",
  rostersByTeamId: { t1: MY_ROSTER, t2: THEIR_ROSTER },
  projectionsByPlayerId: new Map([
    ["rb-gibbs", 15.1],
    ["wr-asb", 14.0],
  ]),
  byeWeeksByNflTeam: new Map([
    ["DET", 8],
    ["LAR", 6],
    ["BUF", 12],
  ]),
  currentWeek: 2,
};

describe("tradeSheetMath", () => {
  it("orients receive and send to the counterparty viewer", () => {
    const math = tradeSheetMath(INPUT);
    expect(math.receive.map((asset) => asset.playerId)).toEqual(["rb-gibbs"]);
    expect(math.send.map((asset) => asset.playerId)).toEqual(["wr-asb"]);
  });

  it("orients the other way for the proposer", () => {
    const math = tradeSheetMath({ ...INPUT, meTeamId: "t2" });
    expect(math.receive.map((asset) => asset.playerId)).toEqual(["wr-asb"]);
    expect(math.send.map((asset) => asset.playerId)).toEqual(["rb-gibbs"]);
  });

  it("prices each side with this week's projection and the real bye", () => {
    const math = tradeSheetMath(INPUT);
    expect(math.receive[0]).toMatchObject({ name: "Jahmyr Gibbs", weekProjection: 15.1, byeWeek: 8 });
    expect(math.send[0]).toMatchObject({ name: "Amon-Ra St. Brown", weekProjection: 14.0, byeWeek: 8 });
  });

  it("leaves the projection null when the snapshot has no row", () => {
    const math = tradeSheetMath({ ...INPUT, projectionsByPlayerId: new Map() });
    expect(math.receive[0]?.weekProjection).toBeNull();
  });

  it("ignores a bye already behind us", () => {
    const math = tradeSheetMath({ ...INPUT, currentWeek: 9 });
    expect(math.receive[0]?.byeWeek).toBeNull();
  });

  it("counts my roster depth before and after", () => {
    const math = tradeSheetMath(INPUT);
    expect(math.depthBefore).toEqual({ WR: 2, RB: 1 });
    expect(math.depthAfter).toEqual({ WR: 1, RB: 2 });
  });

  it("calls a same-week bye shared, nothing new to cover", () => {
    const math = tradeSheetMath(INPUT);
    expect(math.byes).toEqual({ shared: [8], gained: [], cleared: [] });
  });

  it("names a new bye week the trade opens", () => {
    const math = tradeSheetMath({
      ...INPUT,
      byeWeeksByNflTeam: new Map([
        ["DET", 8],
        ["LAR", 6],
      ]),
      trade: {
        ...TRADE,
        from: { ...TRADE.from, assets: [{ kind: "player", playerId: "qb-1" }] },
      },
      projectionsByPlayerId: new Map(),
    });
    // Receiving Josh Allen (BUF, unknown bye -> null) opens nothing; swap to a known bye:
    expect(math.byes.gained).toEqual([]);
    const known = tradeSheetMath({
      ...INPUT,
      trade: { ...TRADE, from: { ...TRADE.from, assets: [{ kind: "player", playerId: "qb-1" }] } },
    });
    expect(known.byes).toEqual({ shared: [], gained: [12], cleared: [8] });
  });

  it("degrades a ghost player to a neutral description", () => {
    const math = tradeSheetMath({
      ...INPUT,
      trade: { ...TRADE, from: { ...TRADE.from, assets: [{ kind: "player", playerId: "ghost" }] } },
    });
    expect(math.receive[0]).toMatchObject({
      name: "a player no longer on this roster",
      position: null,
      byeWeek: null,
    });
  });
});
