import { describe, it, expect } from "vitest";
import type { TradeProposalView } from "@/trades/contract";
import { HOME } from "../test-fixtures";
import type { TradeRoomContext } from "../contract";
import type { LineupFixPlan } from "./lineup-problems";
import { primaryIncoming, problemEvidence, problemHeadline, tradeEvidence, tradeHeadline } from "./moment-copy";

function candidate(projection: number | null): LineupFixPlan["candidates"][number] {
  return { playerId: "wr3", playerName: "Romeo Doubs", position: "WR", nflTeam: "BUF", projection, adp: null, fixture: null, delta: projection };
}

function plan(reason: "empty" | "bye" | "out", candidates: LineupFixPlan["candidates"] = []): LineupFixPlan {
  return {
    problem: { slot: "WR", slotIndex: 0, reason, severity: 1, playerId: reason === "empty" ? null : "wr1", playerName: reason === "empty" ? null : "Zay Flowers", position: "WR" },
    candidates,
    hasProjections: true,
    totalBefore: null,
    totalAfter: null,
  };
}

const TRADE: TradeProposalView = {
  id: "trade-1",
  leagueId: "l1",
  weekNumber: 3,
  status: "open",
  proposedAt: "2026-09-14T12:00:00.000Z",
  expiresAt: "2026-09-18T21:00:00.000Z",
  settledAt: null,
  reversedAt: null,
  note: null,
  from: { teamId: "t2", teamName: "Iron Owls", assets: [{ kind: "player", playerId: "p-owl" }] },
  to: { teamId: "t1", teamName: "Bay Bandits", assets: [{ kind: "player", playerId: "qb1" }] },
};

const CONTEXT: TradeRoomContext = {
  weekNumber: 3,
  myTeamId: "t1",
  counterparties: [{ teamId: "t2", teamName: "Iron Owls" }],
  rostersByTeamId: {
    t1: [{ playerId: "qb1", name: "Josh Allen", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null }],
    t2: [
      { playerId: "p-owl", name: "Marcus Reed", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null },
      { playerId: "p-owl2", name: "Second Passer", position: "QB", nflTeam: "BUF", headshotUrl: null, adp: null },
    ],
  },
  leagueName: "Sunday Money",
};

describe("problemHeadline and problemEvidence", () => {
  it("say the slot and the reason in the second person, and count the bench honestly", () => {
    expect(problemHeadline(plan("empty"), HOME)).toBe("Your WR1 slot is empty");
    expect(problemHeadline(plan("bye"), HOME)).toBe("Your WR1 slot starts a player on bye");
    expect(problemHeadline(plan("out"), HOME)).toBe("Your WR1 slot starts a player ruled out");
    expect(problemEvidence(plan("empty"))).toBe("Nobody is in the slot. No bench player fits the slot, so the wire has your options.");
    expect(problemEvidence(plan("bye", [candidate(9.8)]))).toBe("Zay Flowers sits this week. 1 bench player projects higher than an empty slot.");
    expect(problemEvidence(plan("out", [candidate(null)]))).toBe("Zay Flowers is ruled out. 1 bench player can fill it.");
  });
});

describe("tradeHeadline and tradeEvidence", () => {
  it("name who offers what for what, from their side or yours", () => {
    expect(tradeHeadline(TRADE, CONTEXT)).toBe("Iron Owls offer Marcus Reed for Josh Allen");
    expect(tradeHeadline({ ...TRADE, from: TRADE.to, to: TRADE.from }, CONTEXT)).toBe("Your offer to Iron Owls: Josh Allen for Marcus Reed");
    expect(tradeHeadline(TRADE, null)).toBe("Iron Owls offer a player for a player");
  });

  it("state the deadline, and the position counts when the rosters are known", () => {
    expect(tradeEvidence(TRADE, CONTEXT)).toMatch(/^The offer expires .*\. You carry 1 quarterbacks, they carry 2\.$/);
    expect(tradeEvidence(TRADE, null)).toMatch(/^The offer expires .*\.$/);
    expect(primaryIncoming(TRADE, CONTEXT)?.name).toBe("Marcus Reed");
    expect(primaryIncoming(TRADE, null)).toBeNull();
  });
});
