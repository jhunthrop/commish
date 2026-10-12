import { describe, expect, it } from "vitest";
import type { DraftPoolEntry } from "@research-ts/domain/draft";
import type { Position } from "@research-ts/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { totalRosterSlots } from "@/draft-engine";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { runOneDraft } from "./run";

const TEAM_IDS = Array.from({ length: 12 }, (_, i) => `seat_${i + 1}`);

const BOARD: readonly DraftPoolEntry[] = (() => {
  // Same position mix (and the same reason) as the engine's own `full-draft.test.ts`: a
  // generous, proportionally-interleaved K/DEF supply so no team can ever exhaust the pool's
  // last kickers or defenses before every roster's own dedicated slot is filled.
  const plan: readonly (readonly [Position, number])[] = [["QB", 30], ["RB", 70], ["WR", 80], ["TE", 30], ["K", 20], ["DEF", 20]];
  const buckets = plan.map(([position, count]) => Array.from({ length: count }, (_, i) => ({ playerId: `${position.toLowerCase()}${i + 1}`, position })));
  const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map((r) => r.entry);
})();

describe("runOneDraft", () => {
  it("fills every roster to the configured shape over a full draft, never twice for one player", () => {
    const result = runOneDraft({ teamIds: TEAM_IDS, board: BOARD, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: 15, seed: 1 });
    expect(result.picks).toHaveLength(TEAM_IDS.length * totalRosterSlots(STANDARD_ROSTER_SLOTS));
    expect(new Set(result.picks.map((p) => p.playerId)).size).toBe(result.picks.length);
    for (const teamId of TEAM_IDS) expect(result.rosters[teamId]).toHaveLength(totalRosterSlots(STANDARD_ROSTER_SLOTS));
  });

  it("stops after the requested rounds, leaving later slots empty rather than continuing", () => {
    const result = runOneDraft({ teamIds: TEAM_IDS, board: BOARD, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: 3, seed: 1 });
    expect(result.picks).toHaveLength(TEAM_IDS.length * 3);
    for (const teamId of TEAM_IDS) expect(result.rosters[teamId]!.length).toBeLessThanOrEqual(3);
  });

  it("is exactly reproducible from the same seed", () => {
    const a = runOneDraft({ teamIds: TEAM_IDS, board: BOARD, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: 15, seed: 99 });
    const b = runOneDraft({ teamIds: TEAM_IDS, board: BOARD, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: 15, seed: 99 });
    expect(a.picks).toEqual(b.picks);
  });

  it("a different seed can produce a different draft", () => {
    const a = runOneDraft({ teamIds: TEAM_IDS, board: BOARD, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: 15, seed: 1 });
    const b = runOneDraft({ teamIds: TEAM_IDS, board: BOARD, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: 15, seed: 2 });
    expect(a.picks).not.toEqual(b.picks);
  });

  it("a seat with a board of its own picks from THAT board while the rest of the room picks from the room's", () => {
    // The target seat reads our board; every other seat reads the room's market order. Here the
    // two are exact opposites, so "which board did this seat use" is answerable from the pick
    // alone: a bot samples within `MOCK_CONFIG.strategy.reachDepth` of whatever board it reads,
    // and the two boards' windows of that depth are disjoint by construction.
    const REACH_DEPTH = MOCK_CONFIG.strategy.reachDepth;
    const own = [...BOARD].reverse();
    const result = runOneDraft({
      teamIds: TEAM_IDS,
      board: BOARD,
      rosterSlots: STANDARD_ROSTER_SLOTS,
      rounds: 1,
      seed: 4,
      seatBoards: { seat_1: own },
    });
    const pickOf = (teamId: string): string => result.picks.find((p) => p.teamId === teamId)!.playerId;
    expect(own.slice(0, REACH_DEPTH).map((e) => e.playerId)).toContain(pickOf("seat_1"));
    expect(BOARD.slice(0, REACH_DEPTH).map((e) => e.playerId)).toContain(pickOf("seat_2"));
  });

  it("rosters at least one DEF and one K per team, the engine's own starting-slot floor", () => {
    const result = runOneDraft({ teamIds: TEAM_IDS, board: BOARD, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: 15, seed: 5 });
    // STANDARD_ROSTER_SLOTS starts exactly 1 DEF and 1 K per team; the bench is ALSO eligible
    // for either (`STANDARD_ROSTER_SLOTS`'s own `BENCH_SLOT` row), so a legal roster may carry
    // MORE than one of each but never fewer — the floor this asserts.
    for (const teamId of TEAM_IDS) {
      const roster = result.rosters[teamId]!;
      expect(roster.filter((p) => p.position === "DEF").length).toBeGreaterThanOrEqual(1);
      expect(roster.filter((p) => p.position === "K").length).toBeGreaterThanOrEqual(1);
    }
  });
});
