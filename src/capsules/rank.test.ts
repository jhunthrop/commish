import { describe, expect, it } from "vitest";
import { rankPeers, rankWithinGroups, type RankableStat } from "./rank";

function entry(playerId: string, name: string, value: number): RankableStat {
  return { playerId, name, value };
}

describe("rankPeers", () => {
  it("ranks a clean population by value descending, one-based", () => {
    const ranks = rankPeers([entry("p1", "First Back", 300), entry("p2", "Second Back", 200), entry("p3", "Third Back", 100)]);
    expect(ranks.get("p1")!.positionRank).toBe(1);
    expect(ranks.get("p2")!.positionRank).toBe(2);
    expect(ranks.get("p3")!.positionRank).toBe(3);
  });

  it("reports the qualifier count as the whole population's own size, for every member", () => {
    const ranks = rankPeers([entry("p1", "First Back", 300), entry("p2", "Second Back", 200), entry("p3", "Third Back", 100)]);
    expect(ranks.get("p1")!.qualifierCount).toBe(3);
    expect(ranks.get("p2")!.qualifierCount).toBe(3);
    expect(ranks.get("p3")!.qualifierCount).toBe(3);
  });

  it("names the leader with a null neighbor, since there is no name above rank one", () => {
    const ranks = rankPeers([entry("p1", "First Back", 300), entry("p2", "Second Back", 200)]);
    expect(ranks.get("p1")!.namedNeighbor).toBeNull();
  });

  it("names the peer one rank above for a second or third place finish", () => {
    const ranks = rankPeers([entry("p1", "First Back", 300), entry("p2", "Second Back", 200), entry("p3", "Third Back", 100)]);
    expect(ranks.get("p2")!.namedNeighbor).toBe("First Back");
    expect(ranks.get("p3")!.namedNeighbor).toBe("Second Back");
  });

  it("never names a neighbor at rank four or worse", () => {
    const ranks = rankPeers([
      entry("p1", "First Back", 400),
      entry("p2", "Second Back", 300),
      entry("p3", "Third Back", 200),
      entry("p4", "Fourth Back", 100),
    ]);
    expect(ranks.get("p4")!.positionRank).toBe(4);
    expect(ranks.get("p4")!.namedNeighbor).toBeNull();
  });

  it("gives tied peers the same rank and skips the number after them, golf-leaderboard style", () => {
    const ranks = rankPeers([entry("p1", "First Back", 300), entry("p2", "Tied Back A", 200), entry("p3", "Tied Back B", 200), entry("p4", "Fourth Back", 100)]);
    expect(ranks.get("p2")!.positionRank).toBe(2);
    expect(ranks.get("p3")!.positionRank).toBe(2);
    expect(ranks.get("p4")!.positionRank).toBe(4);
  });

  it("resolves a tied neighbor deterministically, by playerId, when a rank is shared", () => {
    // p2 and p3 tie at 200 (both rank 2); p4 at 100 is rank 4 (not top-3, so no neighbor is
    // asserted there). p1 at rank 1 is the neighbor for whichever of the tied pair is looked up.
    const ranks = rankPeers([entry("p1", "First Back", 300), entry("p3", "Tied Back B", 200), entry("p2", "Tied Back A", 200)]);
    expect(ranks.get("p2")!.namedNeighbor).toBe("First Back");
    expect(ranks.get("p3")!.namedNeighbor).toBe("First Back");
  });

  it("returns an empty map for an empty population", () => {
    expect(rankPeers([]).size).toBe(0);
  });

  it("ranks a lone qualifier as first with no neighbor and a qualifier count of one", () => {
    const ranks = rankPeers([entry("p1", "Only Back", 50)]);
    expect(ranks.get("p1")).toEqual({ value: 50, positionRank: 1, qualifierCount: 1, namedNeighbor: null });
  });
});

describe("rankWithinGroups", () => {
  it("ranks each group independently, never against the other group's own population", () => {
    const groups = new Map([
      ["RB", [entry("rb1", "First Back", 300), entry("rb2", "Second Back", 100)]],
      ["WR", [entry("wr1", "First Receiver", 50), entry("wr2", "Second Receiver", 10)]],
    ]);
    const ranks = rankWithinGroups(groups);
    expect(ranks.get("rb1")!.positionRank).toBe(1);
    expect(ranks.get("rb1")!.qualifierCount).toBe(2);
    expect(ranks.get("wr1")!.positionRank).toBe(1);
    expect(ranks.get("wr1")!.qualifierCount).toBe(2);
    expect(ranks.get("wr2")!.namedNeighbor).toBe("First Receiver");
  });

  it("returns an empty map for an empty set of groups", () => {
    expect(rankWithinGroups(new Map()).size).toBe(0);
  });
});
