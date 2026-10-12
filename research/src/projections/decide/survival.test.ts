import { describe, expect, it } from "vitest";
import type { Position } from "@research/domain/player";
import {
  MIN_DRAFTS_FOR_ROOM_TENDENCY,
  roomTendency,
  survivalProbabilities,
  survivalProbability,
  type BoardEntry,
  type RoomDraftRecord,
} from "./survival";

/** A consensus board: `count` players, average draft position 1, 2, 3 and so on. */
function consensusBoard(count: number): readonly BoardEntry[] {
  const positions: readonly Position[] = ["RB", "WR", "QB", "TE"];
  return Array.from({ length: count }, (_, index) => ({
    playerId: `P${index + 1}`,
    position: positions[index % positions.length]!,
    averageDraftPosition: index + 1,
  }));
}

const BOARD = consensusBoard(200);

describe("survivalProbability", () => {
  it("THE STRUCTURAL CASE: probability falls monotonically as the gap to your next pick widens", () => {
    const previous = { value: Infinity };
    for (let nextPick = 38; nextPick <= 120; nextPick += 1) {
      const survival = survivalProbability("P30", { board: BOARD, fromPick: 37, toPick: nextPick });
      expect(survival).toBeLessThan(previous.value);
      expect(survival).toBeGreaterThanOrEqual(0);
      expect(survival).toBeLessThanOrEqual(1);
      previous.value = survival;
    }
  });

  it("is exactly certain when nobody picks in between", () => {
    expect(survivalProbability("P1", { board: BOARD, fromPick: 10, toPick: 11 })).toBe(1);
  });

  it("gives the top of the board a worse chance than the deep pool over the same gap", () => {
    const top = survivalProbability("P1", { board: BOARD, fromPick: 1, toPick: 25 });
    const deep = survivalProbability("P150", { board: BOARD, fromPick: 1, toPick: 25 });
    expect(top).toBeLessThan(0.05);
    expect(deep).toBeGreaterThan(0.95);
  });

  it("is about even money when the gap matches his place in the queue", () => {
    const even = survivalProbability("P24", { board: BOARD, fromPick: 1, toPick: 25 });
    expect(even).toBeGreaterThan(0.4);
    expect(even).toBeLessThan(0.6);
  });

  it("reads his place on the BOARD, not the average draft position he was given", () => {
    // Same player, same stated market price. In the second board the thirty-five men ahead of
    // him have already gone, so he is the best available and will not last.
    const thinned = BOARD.filter((entry) => entry.averageDraftPosition >= 36);
    const early = survivalProbability("P40", { board: BOARD, fromPick: 1, toPick: 13 });
    const late = survivalProbability("P40", { board: thinned, fromPick: 60, toPick: 72 });
    expect(early).toBeGreaterThan(0.9);
    expect(late).toBeLessThan(0.3);
  });

  it("refuses a player who is not on the board rather than answering about a drafted man", () => {
    expect(() => survivalProbability("nobody", { board: BOARD, fromPick: 1, toPick: 13 })).toThrow(/nobody/);
  });

  it("refuses a next turn that is not after this one", () => {
    expect(() => survivalProbability("P1", { board: BOARD, fromPick: 20, toPick: 20 })).toThrow(/20/);
  });
});

describe("survivalProbabilities", () => {
  it("answers for the whole board in one pass, agreeing with the single-player call", () => {
    const all = survivalProbabilities({ board: BOARD, fromPick: 37, toPick: 60 });
    expect(all.size).toBe(BOARD.length);
    expect(all.get("P50")).toBe(survivalProbability("P50", { board: BOARD, fromPick: 37, toPick: 60 }));
  });
});

describe("roomTendency", () => {
  /** Three drafts in one room. Quarterbacks go a round early in all of them. */
  const drafts: readonly RoomDraftRecord[] = Array.from({ length: 3 }, () => ({
    picks: [
      { pickNumber: 1, position: "QB" as Position, averageDraftPosition: 14 },
      { pickNumber: 5, position: "QB" as Position, averageDraftPosition: 19 },
      { pickNumber: 8, position: "RB" as Position, averageDraftPosition: 8 },
      { pickNumber: 12, position: "WR" as Position, averageDraftPosition: 11 },
    ],
  }));

  it("measures how many picks early this room takes each position", () => {
    const tendency = roomTendency(drafts);
    expect(tendency.draftsObserved).toBe(3);
    expect(tendency.picksEarlyByPosition.QB).toBeCloseTo(13.5, 6);
    expect(tendency.picksEarlyByPosition.RB).toBeCloseTo(0, 6);
    expect(tendency.picksEarlyByPosition.WR).toBeCloseTo(-1, 6);
  });

  it("shortens a quarterback's survival in a room that reaches for quarterbacks", () => {
    const tendency = roomTendency(drafts);
    const query = { board: BOARD, fromPick: 1, toPick: 25 } as const;
    // P39 is a quarterback on the board above (index 38, positions cycle RB/WR/QB/TE).
    const quarterback = BOARD.find((entry) => entry.position === "QB" && entry.averageDraftPosition > 30)!;
    const plain = survivalProbability(quarterback.playerId, query);
    const inThisRoom = survivalProbability(quarterback.playerId, { ...query, room: tendency });
    expect(inThisRoom).toBeLessThan(plain);
  });

  it("ignores a room it has barely seen, because one draft is an anecdote", () => {
    const one = roomTendency(drafts.slice(0, 1));
    expect(one.draftsObserved).toBeLessThan(MIN_DRAFTS_FOR_ROOM_TENDENCY);
    const query = { board: BOARD, fromPick: 1, toPick: 25 } as const;
    const quarterback = BOARD.find((entry) => entry.position === "QB" && entry.averageDraftPosition > 30)!;
    expect(survivalProbability(quarterback.playerId, { ...query, room: one })).toBe(
      survivalProbability(quarterback.playerId, query),
    );
  });

  it("carries no identity at all, so a cross-league dossier cannot be built from it", () => {
    const tendency = roomTendency(drafts);
    const serialised = JSON.stringify(tendency);
    expect(serialised).not.toMatch(/team|user|owner|name|id/i);
    expect(Object.keys(tendency).sort()).toEqual(["draftsObserved", "picksEarlyByPosition"]);
  });
});
