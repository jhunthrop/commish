import { describe, it, expect } from "vitest";
import type { Player } from "@research-ts/domain/player";
import type { CompletedPick } from "@/draft-engine";
import { reviewPicks } from "./pick-review";

function player(id: string, position: Player["position"], adp: number | null = null): Player {
  return { id, name: id, position, nflTeam: "KC", headshotUrl: null, adp };
}

function pick(overrides: Partial<CompletedPick> & Pick<CompletedPick, "pickNumber" | "teamId" | "playerId">): CompletedPick {
  return { round: 1, slot: "BENCH", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false, ...overrides };
}

describe("reviewPicks", () => {
  it("states 0/0 for the best-available case — the board's own top player, taken at the turn", () => {
    const players = [player("p1", "RB"), player("p2", "WR"), player("p3", "QB")];
    const picks = [pick({ pickNumber: 1, teamId: "me", playerId: "p1" })];
    const reviews = reviewPicks(players, picks, "me");
    expect(reviews).toEqual([{ pickNumber: 1, playerId: "p1", bestAvailableDelta: 0, positionRank: 1, positionBestDelta: 0 }]);
  });

  it("counts a mid reach at both the overall and position level — a same-position player skipped over", () => {
    // p1 (WR1) and p2 (WR2) both still on the board; the pick takes p2, skipping the board's
    // (and the position's) own best player still available.
    const players = [player("p1", "WR"), player("p2", "WR"), player("p3", "RB")];
    const picks = [pick({ pickNumber: 1, teamId: "me", playerId: "p2" })];
    const reviews = reviewPicks(players, picks, "me");
    expect(reviews).toEqual([{ pickNumber: 1, playerId: "p2", bestAvailableDelta: 1, positionRank: 2, positionBestDelta: 1 }]);
  });

  it("reads a late kicker honestly — a big overall delta from OTHER positions still on the board, 0 at the kicker's own position (the D3 case)", () => {
    // Two skill players are still undrafted when the pick happens (never taken by anyone), but
    // the only other kicker on the board (k1) was already taken — so k2 is the board's own best
    // AVAILABLE kicker even though plenty of higher-ranked players (at other positions) remain.
    const players = [player("p1", "RB"), player("p2", "WR"), player("k1", "K"), player("k2", "K")];
    const picks = [pick({ pickNumber: 1, teamId: "opp", playerId: "k1" }), pick({ pickNumber: 2, teamId: "me", playerId: "k2" })];
    const reviews = reviewPicks(players, picks, "me");
    expect(reviews).toEqual([{ pickNumber: 2, playerId: "k2", bestAvailableDelta: 2, positionRank: 2, positionBestDelta: 0 }]);
  });

  it("lists an autopick exactly like a human one — still a fact, still in the log", () => {
    const players = [player("p1", "RB")];
    const picks = [pick({ pickNumber: 1, teamId: "me", playerId: "p1", auto: true })];
    const reviews = reviewPicks(players, picks, "me");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ pickNumber: 1, playerId: "p1" });
  });

  it("only lists the caller's own picks, in pick order regardless of input order", () => {
    const players = [player("p1", "RB"), player("p2", "WR"), player("p3", "QB")];
    const picks = [
      pick({ pickNumber: 3, teamId: "me", playerId: "p3" }),
      pick({ pickNumber: 1, teamId: "opp", playerId: "p1" }),
      pick({ pickNumber: 2, teamId: "me", playerId: "p2" }),
    ];
    const reviews = reviewPicks(players, picks, "me");
    expect(reviews.map((review) => review.pickNumber)).toEqual([2, 3]);
  });

  it("drops a pick whose player is not in the snapshotted pool rather than fabricating a fact", () => {
    const players = [player("p1", "RB")];
    const picks = [pick({ pickNumber: 1, teamId: "me", playerId: "ghost" })];
    expect(reviewPicks(players, picks, "me")).toEqual([]);
  });

  it("is empty when the caller made no picks", () => {
    const players = [player("p1", "RB")];
    const picks = [pick({ pickNumber: 1, teamId: "opp", playerId: "p1" })];
    expect(reviewPicks(players, picks, "me")).toEqual([]);
  });
});
