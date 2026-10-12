import { describe, expect, it } from "vitest";
import type { Player } from "@research/domain/player";
import { DRAFT_ROOM_CONFIG } from "../state/config";
import type { Position } from "@research/domain/player";
import { formatAdp, poolTiers, positionRanks } from "./tiers";

const TEAMS = 12;

function player(id: string, adp: number | null): Player {
  return { id, name: id, position: "RB", nflTeam: "BAL", headshotUrl: null, adp };
}

/** A run of `count` players with no cliff between them, starting at `from` and stepping by 1. */
function run(prefix: string, from: number, count: number): readonly Player[] {
  return Array.from({ length: count }, (_, index) => player(`${prefix}${index}`, from + index));
}

describe("poolTiers", () => {
  it("opens a band only where the consensus board actually steps down", () => {
    const players = [...run("a", 1, DRAFT_ROOM_CONFIG.tiers.minBandSize), ...run("b", 40, DRAFT_ROOM_CONFIG.tiers.minBandSize)];
    const tiers = poolTiers(players, TEAMS);
    expect(tiers.get("a0")!.id).toBe(0);
    expect(tiers.get(`a${DRAFT_ROOM_CONFIG.tiers.minBandSize - 1}`)!.id).toBe(0);
    expect(tiers.get("b0")!.id).toBe(1);
  });

  it("does not open a band for a gap under the cliff", () => {
    const near = DRAFT_ROOM_CONFIG.tiers.cliffAdp - 1;
    const players = [...run("a", 1, DRAFT_ROOM_CONFIG.tiers.minBandSize), player("b0", DRAFT_ROOM_CONFIG.tiers.minBandSize + near)];
    const tiers = poolTiers(players, TEAMS);
    expect(tiers.get("b0")!.id).toBe(tiers.get("a0")!.id);
  });

  it("holds a cliff until the band it would close is worth drawing", () => {
    // Every adjacent pair here is a cliff. Only the ones landing after a full band may open one,
    // which is what stops the sparse tail of the feed drawing a rung per player.
    const players = Array.from({ length: 6 }, (_, index) => player(`p${index}`, 1 + index * DRAFT_ROOM_CONFIG.tiers.cliffAdp * 2));
    const tiers = poolTiers(players, TEAMS);
    const ids = players.map((entry) => tiers.get(entry.id)!.id);
    expect(ids.slice(0, DRAFT_ROOM_CONFIG.tiers.minBandSize)).toEqual(
      Array.from({ length: DRAFT_ROOM_CONFIG.tiers.minBandSize }, () => 0),
    );
    expect(ids[DRAFT_ROOM_CONFIG.tiers.minBandSize]).toBe(1);
  });

  it("grades a band by the consensus round of its best player, for this room's seat count", () => {
    const players = [...run("a", 1, 8), ...run("b", 60, 8)];
    // Twelve seats: ADP 1 is round 1 (grade S); ADP 60 is round 5 (grade B).
    expect(poolTiers(players, 12).get("a0")!.grade).toBe("S");
    expect(poolTiers(players, 12).get("b0")!.grade).toBe("B");
    // Four seats: the same ADP 60 is round 15, past the last named round, so it takes the last
    // grade. The room's own shape changes the grade, which is the point of passing it in.
    expect(poolTiers(players, 4).get("b0")!.grade).toBe("C");
  });

  it("labels a band with the consensus round its players go in", () => {
    const tiers = poolTiers(run("a", 13, 7), TEAMS);
    expect(tiers.get("a0")!.label).toBe("usually drafted in round 2");
  });

  it("labels a one-player band with a single round rather than a range of itself", () => {
    const tiers = poolTiers([player("only", 4.2)], TEAMS);
    expect(tiers.get("only")!.label).toBe("usually drafted in round 1");
  });

  it("names the step down for a band a cliff actually sealed", () => {
    // Every adjacent pair here is a cliff; the sparse tail rule (minBandSize) is what makes only
    // the FIRST band eligible to seal here, so it is the one whose label gets the drop clause.
    // p0..p3 (ADP 1, 7, 13, 19) seal as one band once it reaches minBandSize: round 1 to round 2.
    const players = Array.from({ length: 6 }, (_, index) => player(`p${index}`, 1 + index * DRAFT_ROOM_CONFIG.tiers.cliffAdp * 2));
    const tiers = poolTiers(players, TEAMS);
    expect(tiers.get("p0")!.label).toBe("usually drafted in rounds 1 to 2 · next tier is a big step down");
  });

  it("never claims a drop for the ladder's last band, since nothing was measured after it", () => {
    const tiers = poolTiers(run("a", 13, 7), TEAMS);
    expect(tiers.get("a0")!.label).not.toContain("step down");
  });

  it("gives an unranked player no band at all", () => {
    const tiers = poolTiers([...run("a", 1, 6), player("unranked", null)], TEAMS);
    expect(tiers.has("unranked")).toBe(false);
  });

  it("yields nothing before the room has a seat count to grade against", () => {
    expect(poolTiers(run("a", 1, 6), 0).size).toBe(0);
  });

  it("never opens a band where the pool order runs against ADP", () => {
    const players = [...run("a", 40, DRAFT_ROOM_CONFIG.tiers.minBandSize), player("b0", 1)];
    expect(poolTiers(players, TEAMS).get("b0")!.id).toBe(0);
  });
});

describe("formatAdp", () => {
  it("keeps the one decimal a consensus of real drafts carries", () => {
    expect(formatAdp(12.84)).toBe("ADP 12.8");
  });

  it("says nothing at all for a player the feed does not rank", () => {
    expect(formatAdp(null)).toBeNull();
  });
});

/**
 * THE RANK IS THE BOARD'S OWN ORDER, restated. `players` arrives server-ranked, best first, so the
 * fourth running back down it IS this board's RB4 — no projection, no second ranking of ours, and
 * nothing the feed would have to start carrying.
 */
describe("positionRanks", () => {
  function at(position: Position, id: string): Player {
    return { id, name: id, position, nflTeam: "BAL", headshotUrl: null, adp: null };
  }

  it("counts each position separately, down the board's own order", () => {
    const board = [at("QB", "q1"), at("RB", "r1"), at("RB", "r2"), at("WR", "w1"), at("RB", "r3")];
    const ranks = positionRanks(board);
    expect(ranks.get("q1")).toBe(1);
    expect(ranks.get("r1")).toBe(1);
    expect(ranks.get("r2")).toBe(2);
    expect(ranks.get("r3")).toBe(3);
    expect(ranks.get("w1")).toBe(1);
  });

  it("answers nothing for a player who is not on the board at all", () => {
    expect(positionRanks([at("TE", "t1")]).get("someone-else")).toBeUndefined();
  });

  it("has an answer for every player it was handed, so no row can render a half-empty sticker", () => {
    const board = [at("K", "k1"), at("DEF", "d1"), at("K", "k2")];
    expect(positionRanks(board).size).toBe(board.length);
  });
});
