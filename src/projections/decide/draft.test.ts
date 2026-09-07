import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { recommendPick, type DraftCandidate, type RosteredPlayer } from "./draft";
import type { LeagueShape } from "./replacement";

const SHAPE: LeagueShape = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };

function candidate(
  playerId: string,
  position: Position,
  valueOverReplacement: number,
  averageDraftPosition: number,
): DraftCandidate {
  return {
    playerId,
    position,
    projectedPoints: 200 + valueOverReplacement,
    valueOverReplacement,
    positionRank: 1,
    replacementLevel: 200,
    averageDraftPosition,
  };
}

/** Filler so the board is a board rather than two men, at a value nobody would prefer. */
function filler(position: Position, count: number, from: number, value: number): readonly DraftCandidate[] {
  return Array.from({ length: count }, (_, index) =>
    candidate(`${position}-fill-${index}`, position, value, from + index),
  );
}

const codesOf = (reasons: readonly { readonly code: string }[]): readonly string[] =>
  reasons.map((reason) => reason.code);

describe("recommendPick", () => {
  it("TWO NEAR-EQUAL MEN: takes the one who will not survive to the next turn", () => {
    const goingNow = candidate("goingNow", "WR", 100, 38);
    const willKeep = candidate("willKeep", "WR", 99, 95);
    const board = [goingNow, willKeep, ...filler("WR", 55, 39, 50)];

    const [best, second] = recommendPick({
      board,
      roster: [],
      shape: SHAPE,
      pickNumber: 37,
      nextPickNumber: 60,
    });

    expect(best!.playerId).toBe("goingNow");
    expect(second!.playerId).toBe("willKeep");
    expect(best!.survivalProbability).toBeLessThan(0.1);
    expect(second!.survivalProbability).toBeGreaterThan(0.9);
    expect(codesOf(best!.reasons)).toContain("will_not_survive");
    expect(codesOf(second!.reasons)).toContain("safe_to_wait");
  });

  it("and it is the survival that did it: move only the market price, and it flips", () => {
    // Identical values, identical roster, identical turns. The ONLY difference is where the
    // market prices the man we would otherwise have to reach for.
    const atRisk = candidate("underrated", "WR", 100, 38);
    const safe = candidate("underrated", "WR", 100, 96);
    const rival = candidate("betterButSafe", "WR", 101, 95);
    const rest = filler("WR", 55, 39, 50);

    const whenAtRisk = recommendPick({
      board: [atRisk, rival, ...rest],
      roster: [],
      shape: SHAPE,
      pickNumber: 37,
      nextPickNumber: 60,
    });
    const whenSafe = recommendPick({
      board: [safe, rival, ...rest],
      roster: [],
      shape: SHAPE,
      pickNumber: 37,
      nextPickNumber: 60,
    });

    expect(whenAtRisk[0]!.playerId).toBe("underrated");
    expect(whenSafe[0]!.playerId).toBe("betterButSafe");
  });

  it("A TIER CLIFF AT AN UNFILLED POSITION: crosses it before it breaks", () => {
    // Two starting receivers and two backs already in. The flex is the only spot a third
    // receiver can take, and tight end is empty.
    // Values carried, because what a candidate is worth is what he adds ON TOP of these men.
    const roster: readonly RosteredPlayer[] = [
      { playerId: "own-wr-1", position: "WR", valueOverReplacement: 120 },
      { playerId: "own-wr-2", position: "WR", valueOverReplacement: 110 },
      { playerId: "own-rb-1", position: "RB", valueOverReplacement: 130 },
      { playerId: "own-rb-2", position: "RB", valueOverReplacement: 100 },
    ];
    const lastGoodTightEnd = candidate("lastGoodTightEnd", "TE", 70, 40);
    const anotherReceiver = candidate("anotherReceiver", "WR", 70, 90);
    const board = [
      lastGoodTightEnd,
      anotherReceiver,
      // The cliff: every other tight end is a different animal.
      ...filler("TE", 20, 120, 12),
      // Receivers stay plentiful at nearly the same value, so waiting on one costs almost nothing.
      ...filler("WR", 40, 91, 68),
    ];

    const [best] = recommendPick({
      board,
      roster,
      shape: SHAPE,
      pickNumber: 37,
      nextPickNumber: 60,
    });

    expect(best!.playerId).toBe("lastGoodTightEnd");
    expect(codesOf(best!.reasons)).toContain("tier_cliff");
    const cliff = best!.reasons.find((reason) => reason.code === "tier_cliff")!;
    expect(cliff).toMatchObject({ code: "tier_cliff", position: "TE" });
  });

  it("NO CLIFF ON A WITHIN-TIER STEP: a span split is a boundary, not a warning (dossier-voice round)", () => {
    // Eight tight ends five points apart (240 down to 205). No step is a game's worth of the man
    // above, so rule 1 draws no break; the run is 35 points end to end, so the SPAN rule splits it
    // in two. The man at the split's own edge is "the last man in his tier" with a five point drop
    // behind him, which is exactly the sentence the founder read on a player nobody should avoid.
    const board = [
      ...Array.from({ length: 8 }, (_, index) => candidate(`te-${index}`, "TE", 40 - index * 5, 10 + index)),
      ...filler("WR", 40, 40, 20),
    ];

    const shortlist = recommendPick({ board, roster: [], shape: SHAPE, pickNumber: 1, nextPickNumber: 24 });

    for (const entry of shortlist) {
      expect(codesOf(entry.reasons)).not.toContain("tier_cliff");
    }
  });

  it("ROSTER SATURATION: a fifth back ranks below a first tight end at the same value", () => {
    // Four backs already better than the fifth: every slot a back can start in is held.
    const roster: readonly RosteredPlayer[] = Array.from({ length: 4 }, (_, index) => ({
      playerId: `own-rb-${index}`,
      position: "RB" as Position,
      valueOverReplacement: 140 - index * 10,
    }));
    const fifthBack = candidate("fifthBack", "RB", 60, 50);
    const firstTightEnd = candidate("firstTightEnd", "TE", 60, 50);
    const board = [fifthBack, firstTightEnd, ...filler("WR", 30, 60, 30)];

    // A long shortlist on purpose: the point is where the fifth back lands, not that he is cut.
    const ranked = recommendPick({
      board,
      roster,
      shape: SHAPE,
      pickNumber: 37,
      nextPickNumber: 60,
      shortlistSize: board.length,
    });
    const rankOf = (playerId: string): number => ranked.findIndex((r) => r.playerId === playerId);
    expect(rankOf("fifthBack")).toBeGreaterThan(-1);

    expect(rankOf("firstTightEnd")).toBeLessThan(rankOf("fifthBack"));
    // The tight end fills an empty slot, so all sixty points of him count. The fifth back adds
    // nothing to any lineup this roster can field, and only his insurance value survives.
    expect(ranked.find((r) => r.playerId === "firstTightEnd")!.rosterAdjustedValue).toBeGreaterThan(60);
    expect(ranked.find((r) => r.playerId === "fifthBack")!.rosterAdjustedValue).toBeLessThan(10);
    expect(codesOf(ranked.find((r) => r.playerId === "fifthBack")!.reasons)).toContain("roster_saturated");
    expect(codesOf(ranked.find((r) => r.playerId === "firstTightEnd")!.reasons)).toContain(
      "fills_starting_slot",
    );
  });

  it("stops looking ahead at the last pick of the draft, and says so", () => {
    const board = [candidate("a", "WR", 100, 38), ...filler("WR", 20, 39, 40)];
    const [best] = recommendPick({
      board,
      roster: [],
      shape: SHAPE,
      pickNumber: 180,
      nextPickNumber: null,
    });
    expect(best!.survivalProbability).toBe(0);
    expect(best!.expectedValueAdded).toBe(best!.rosterAdjustedValue);
    expect(codesOf(best!.reasons)).toContain("no_further_turn");
  });

  it("EVERY REASON IS DATA, never a sentence for the room to print verbatim", () => {
    const board = [candidate("a", "WR", 100, 38), ...filler("WR", 30, 39, 60)];
    const [best] = recommendPick({ board, roster: [], shape: SHAPE, pickNumber: 1, nextPickNumber: 24 });
    expect(best!.reasons.length).toBeGreaterThan(0);
    for (const reason of best!.reasons) {
      for (const [key, value] of Object.entries(reason)) {
        if (key === "code") continue;
        // A number, or a token from a closed vocabulary. Never prose: the room renders these.
        if (typeof value === "string") expect(value).toMatch(/^[A-Z_]+$/);
        else expect(typeof value).toBe("number");
      }
    }
  });

  it("never recommends a man the roster has no room for", () => {
    // Every slot a quarterback could take is already full: one starting spot and six bench.
    const roster: readonly RosteredPlayer[] = Array.from({ length: 7 }, (_, index) => ({
      playerId: `own-qb-${index}`,
      position: "QB" as Position,
      valueOverReplacement: 50,
    }));
    const board = [candidate("eighthQuarterback", "QB", 300, 1), ...filler("WR", 20, 2, 10)];
    const ranked = recommendPick({ board, roster, shape: SHAPE, pickNumber: 37, nextPickNumber: 60 });
    expect(ranked.some((r) => r.playerId === "eighthQuarterback")).toBe(false);
  });

  it("returns a shortlist rather than the whole board, and the same one twice", () => {
    const board = filler("WR", 60, 1, 40);
    const query = { board, roster: [], shape: SHAPE, pickNumber: 37, nextPickNumber: 60 } as const;
    const first = recommendPick(query);
    expect(first.length).toBeLessThanOrEqual(5);
    expect(recommendPick(query)).toEqual(first);
  });
});
