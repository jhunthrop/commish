import { describe, it, expect } from "vitest";
import type { Player } from "@research-ts/domain/player";
import type { CompletedPick } from "@/draft-engine";
import { magnitudeStep } from "@/components/ui/stat";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import { slipOf, verdictFor, verdictForPick, verdictKindOf, verdictPopulation } from "./verdict";

function player(id: string, adp: number | null = null): Player {
  return { id, name: id, position: "RB", nflTeam: "KC", headshotUrl: null, adp };
}

/** Twenty ranked players, so a board rank and a pick slot can be far enough apart to be a
 *  verdict rather than rounding. ADP matches the index, so the array order the verdict reads as
 *  board rank is the order `rankedPlayers` would sort these into. */
const POOL: readonly Player[] = Array.from({ length: 20 }, (_, index) => player(`p${index + 1}`, index + 1));

function pick(pickNumber: number, playerId: string, teamId = "me"): CompletedPick {
  return { pickNumber, round: 1, teamId, playerId, slot: "BENCH", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false };
}

describe("slipOf", () => {
  it("counts how many picks later than his rank a player actually went", () => {
    // The board's 5th player, still there at pick 16: he lasted eleven picks past his rank.
    expect(slipOf(5, 16)).toBe(11);
  });

  it("goes negative for a player taken ahead of his rank", () => {
    expect(slipOf(20, 8)).toBe(-12);
  });

  it("is zero when the pick slot is exactly the board rank", () => {
    expect(slipOf(7, 7)).toBe(0);
  });
});

describe("verdictKindOf", () => {
  const band = DRAFT_ROOM_CONFIG.verdict.evenBandPicks;

  it("calls a big positive slip a steal and a big negative one a reach", () => {
    expect(verdictKindOf(band + 1)).toBe("steal");
    expect(verdictKindOf(-band - 1)).toBe("reach");
  });

  it("calls everything inside the band even, on both sides and at the edge", () => {
    expect(verdictKindOf(0)).toBe("even");
    expect(verdictKindOf(band)).toBe("even");
    expect(verdictKindOf(-band)).toBe("even");
  });

  /** The band is a tunable, never a literal in a component: it is the whole difference between
   *  "a steal" and "a fine pick", and a persona review has to be able to find it in one file. */
  it("reads its band from config rather than a number written here", () => {
    expect(band).toBeGreaterThan(0);
  });
});

describe("verdictPopulation", () => {
  it("carries the board's own ranks, 1-based, in the snapshot order", () => {
    const { boardRanks } = verdictPopulation(POOL, []);
    expect(boardRanks.get("p1")).toBe(1);
    expect(boardRanks.get("p20")).toBe(20);
  });

  it("collects one slip per completed pick, ascending", () => {
    // p3 at pick 1 is two picks early (-2), p1 at pick 2 is one late (+1), p10 at pick 3 is
    // seven early (-7) — collected in pick order, returned in slip order.
    const picks = [pick(1, "p3"), pick(2, "p1"), pick(3, "p10")];
    expect(verdictPopulation(POOL, picks).slips).toEqual([-7, -2, 1]);
  });

  it("skips a pick whose player is not in the snapshotted pool rather than inventing a slip", () => {
    expect(verdictPopulation(POOL, [pick(1, "ghost")]).slips).toEqual([]);
  });
});

describe("verdictFor", () => {
  it("names the steal and states the slip with its sign", () => {
    const population = verdictPopulation(POOL, [pick(1, "p1")]);
    const verdict = verdictFor(population, 5, 16);
    expect(verdict.kind).toBe("steal");
    expect(verdict.slip).toBe(11);
    expect(verdict.value).toBe("+11");
  });

  it("names the reach and keeps the minus sign, which is the fact", () => {
    const population = verdictPopulation(POOL, [pick(1, "p1")]);
    expect(verdictFor(population, 20, 8).value).toBe("-12");
  });

  /**
   * THE GATE THAT MATTERS. Rule 1's magnitude amendment permits colour only where the comparison
   * is genuine and stated. The first pick of a draft has no picks to compare against, so it gets
   * no comparison at all — and `magnitudeStep` answers `neutral`, which IS `textPrimary`. An
   * uncoloured verdict is the honest one, never a guess dressed as a judgement.
   */
  it("offers no comparison at all before this room has made a pick", () => {
    const verdict = verdictFor(verdictPopulation(POOL, []), 5, 16);
    expect(verdict.comparison).toBeUndefined();
    expect(magnitudeStep(verdict.comparison)).toBe("neutral");
  });

  it("states the population in the words a manager would use, so Stat can read it out", () => {
    const population = verdictPopulation(POOL, [pick(1, "p1"), pick(2, "p2")]);
    expect(verdictFor(population, 5, 16).comparison?.population).toBe("picks in this room");
  });

  it("colours a steal strong and a reach bad against a room that drafted to the board", () => {
    // Ten picks, every one of them straight down the board: a flat population of zero slips.
    const picks = Array.from({ length: 10 }, (_, index) => pick(index + 1, `p${index + 1}`));
    const population = verdictPopulation(POOL, picks);
    expect(population.slips).toEqual(Array.from({ length: 10 }, () => 0));

    expect(magnitudeStep(verdictFor(population, 2, 15).comparison)).toBe("strong");
    expect(magnitudeStep(verdictFor(population, 18, 3).comparison)).toBe("bad");
    // A pick that matched the board sits at the middle of its own ramp, not at the bottom: ties
    // count half, which is what keeps a room that drafted honestly from reading as a room of
    // failures.
    expect(magnitudeStep(verdictFor(population, 4, 4).comparison)).toBe("neutral");
  });

  it("keeps the percentile inside the scale at both extremes", () => {
    const population = verdictPopulation(POOL, [pick(1, "p1"), pick(2, "p2")]);
    for (const [rank, slot] of [[1, 1], [20, 1], [1, 20]] as const) {
      const percentile = verdictFor(population, rank, slot).comparison?.percentile ?? -1;
      expect(percentile).toBeGreaterThanOrEqual(0);
      expect(percentile).toBeLessThanOrEqual(1);
    }
  });
});

describe("verdictForPick", () => {
  it("judges a completed pick by the same arithmetic a prospect gets", () => {
    const picks = [pick(1, "p1"), pick(2, "p2"), pick(16, "p5")];
    const population = verdictPopulation(POOL, picks);
    expect(verdictForPick(population, picks[2]!)).toMatchObject({ kind: "steal", slip: 11, value: "+11" });
  });

  it("says nothing at all about a pick whose player is not in the snapshotted pool", () => {
    const population = verdictPopulation(POOL, [pick(1, "p1")]);
    expect(verdictForPick(population, pick(2, "ghost"))).toBeNull();
  });
});
