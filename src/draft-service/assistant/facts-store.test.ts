import { describe, expect, it } from "vitest";
import type { PlayedPick } from "../sim/continue";
import { deserializeRoomFacts, serializeRoomFacts } from "./facts-store";
import type { RoomFacts } from "./memo";

const ORDER = ["t1", "t2", "t3", "t4"];

/** A 4-team snake from pick 3: t3, t4, t4, t3, t2, t1 ... */
const snake = (fromPick: number, playerIds: readonly string[]): readonly PlayedPick[] =>
  playerIds.map((playerId, i) => {
    const pickNumber = fromPick + i;
    const round = Math.ceil(pickNumber / ORDER.length);
    const index = (pickNumber - 1) % ORDER.length;
    return { pickNumber, teamId: ORDER[round % 2 === 1 ? index : ORDER.length - 1 - index]!, playerId };
  });

const facts: RoomFacts = {
  table: {
    runs: 3,
    fromPick: 3,
    throughPick: 8,
    played: [
      snake(3, ["a", "b", "c", "d", "e", "f"]),
      // A run that ended early (the draft completed): still a plain continuation.
      snake(3, ["a", "b"]),
      // A run that is NOT a plain continuation (a seat skipped): kept whole on the wire.
      [{ pickNumber: 3, teamId: "t3", playerId: "a" }, { pickNumber: 5, teamId: "t4", playerId: "z" }],
    ],
  },
  tiers: { a: { tier: 1, left: 2, size: 4 } },
  collapses: [{ position: "RB", playersLeftInTier: 1, dropToNextTier: 9.5 }],
};

describe("the wire form", () => {
  it("round-trips exactly, compacting plain continuations to player ids and keeping every other run whole", () => {
    const text = serializeRoomFacts(facts, ORDER);
    expect(deserializeRoomFacts(text, ORDER)).toEqual(facts);
    const wire = JSON.parse(text) as { played: unknown[] };
    expect(wire.played[0]).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(wire.played[2]).toEqual(facts.table.played[2]);
    // Fifty-odd bytes per pick verbatim against a handful compacted.
    expect(text.length).toBeLessThan(JSON.stringify(facts).length);
  });

  it("refuses anything that is not its own shape", () => {
    expect(deserializeRoomFacts("{not json", ORDER)).toBeNull();
    expect(deserializeRoomFacts(JSON.stringify({ v: 99, runs: 1, fromPick: 1, throughPick: 1, played: [], tiers: {}, collapses: [] }), ORDER)).toBeNull();
    expect(deserializeRoomFacts(JSON.stringify({ hello: "world" }), ORDER)).toBeNull();
    expect(deserializeRoomFacts("null", ORDER)).toBeNull();
  });

});
