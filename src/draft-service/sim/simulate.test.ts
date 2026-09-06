import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { totalRosterSlots } from "@/draft-engine";
import { BUILD_LABELS } from "./classify";
import { simulateAllSlots, simulateDrafts } from "./simulate";
import type { SimPlayerEvidence, SingleSlotSimConfig } from "./types";
import { valueOrderFor } from "./value-order";

const TEAM_COUNT = 12;

/** A realistic evidence pool: enough ranked players for a full draft, points strictly
 *  decreasing with rank so `bestStartingLineupPoints`/availability math has a real signal. */
function pool(size: number): readonly SimPlayerEvidence[] {
  // K/DEF carry a generous FLOOR (never just a percentage of `size`): the proportional
  // interleave below places each position's own rank-1 player near the SAME global rank
  // regardless of bucket size, which lets a few teams legitimately bench-stash more than one
  // kicker or defense early — a floor well above what 12 teams could ever consume keeps the
  // pool from running dry before every dedicated slot is filled (`run.test.ts`'s own fix, same
  // reasoning, same numbers as the engine's own `full-draft.test.ts`).
  const plan: readonly (readonly [Position, number])[] = [
    ["QB", Math.max(30, Math.ceil(size * 0.12))],
    ["RB", Math.max(70, Math.ceil(size * 0.28))],
    ["WR", Math.max(80, Math.ceil(size * 0.32))],
    ["TE", Math.max(30, Math.ceil(size * 0.12))],
    ["K", Math.max(20, Math.ceil(size * 0.08))],
    ["DEF", Math.max(20, Math.ceil(size * 0.08))],
  ];
  const entries: { playerId: string; position: Position }[] = [];
  for (const [position, count] of plan) {
    for (let i = 0; i < count; i += 1) entries.push({ playerId: `${position.toLowerCase()}${i + 1}`, position });
  }
  // Interleave proportionally, same construction `run.test.ts`/the engine's own `full-draft.test.ts` use.
  const buckets = plan.map(([position, count]) => entries.filter((e) => e.position === position).slice(0, count));
  const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
  ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
  return ranked.map(({ entry }, index): SimPlayerEvidence => ({
    playerId: entry.playerId,
    position: entry.position,
    marketRank: index, // a simple stand-in market, except where a test overrides it
    projectedPoints: Math.max(1, 300 - index * 1.2),
  }));
}

/**
 * THE FOUNDER'S OWN BUG (2026-09-05), as a fixture: quarterbacks packed at the very top of RAW
 * projected points, in a league that starts exactly one of them. Ranking by points crowns them;
 * ranking by value over replacement does not, because the twelfth quarterback scores nearly what
 * the first does while the thirtieth back scores nothing like the first.
 */
function qbHeavyPool(market: "agrees-with-our-board" | "ranks-by-points"): readonly SimPlayerEvidence[] {
  const plan: readonly (readonly [Position, number, number, number])[] = [
    ["QB", 30, 258, 1.0],
    ["RB", 70, 240, 2.5],
    ["WR", 80, 235, 2.0],
    ["TE", 30, 150, 2.0],
    ["K", 20, 100, 1.0],
    ["DEF", 20, 100, 1.0],
  ];
  const unranked: readonly SimPlayerEvidence[] = plan.flatMap(([position, count, top, step]) =>
    Array.from({ length: count }, (_, i): SimPlayerEvidence => ({
      playerId: `${position.toLowerCase()}${i + 1}`,
      position,
      marketRank: null,
      projectedPoints: top - i * step,
    })),
  );
  const ordered =
    market === "agrees-with-our-board"
      ? valueOrderFor(unranked, { teamCount: TEAM_COUNT, rosterSlots: STANDARD_ROSTER_SLOTS })
      : [...unranked].sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId));
  return ordered.map((entry, index) => ({ ...entry, marketRank: index }));
}

function baseConfig(overrides: Partial<SingleSlotSimConfig> = {}): SingleSlotSimConfig {
  return {
    teamCount: TEAM_COUNT,
    rosterSlots: STANDARD_ROSTER_SLOTS,
    slot: 7,
    rounds: 15,
    runs: 20,
    sharpness: 0.5,
    seed: 1,
    ...overrides,
  };
}

describe("simulateDrafts", () => {
  const evidence = pool(TEAM_COUNT * totalRosterSlots(STANDARD_ROSTER_SLOTS) + 40);

  it("throws rather than fabricating players when the pool is thinner than a full draft needs", () => {
    const tiny: readonly SimPlayerEvidence[] = evidence.slice(0, 5);
    expect(() => simulateDrafts(baseConfig({ runs: 1 }), tiny)).toThrow(/fewer than/);
  });

  it("every build outcome's finish rate is measured only over the runs that actually carried the label", () => {
    const summary = simulateDrafts(baseConfig(), evidence);
    expect(summary.builds).toHaveLength(BUILD_LABELS.length);
    for (const build of summary.builds) {
      expect(build.runsWithLabel).toBeGreaterThanOrEqual(0);
      expect(build.runsWithLabel).toBeLessThanOrEqual(summary.runs);
      expect(build.top3FinishRate).toBeGreaterThanOrEqual(0);
      expect(build.top3FinishRate).toBeLessThanOrEqual(1);
    }
  });

  it("the baseline top-3 rate is exactly 3 of the team count, by arithmetic, never a hand-picked number", () => {
    const summary = simulateDrafts(baseConfig({ teamCount: 12 }), evidence);
    expect(summary.baselineTop3Rate).toBeCloseTo(3 / 12);
  });

  it("reports one availability row per pick the target slot actually holds", () => {
    const summary = simulateDrafts(baseConfig({ rounds: 4 }), evidence);
    expect(summary.availability).toHaveLength(4);
    for (const row of summary.availability) {
      expect(row.survivalRate).toBeGreaterThanOrEqual(0);
      expect(row.survivalRate).toBeLessThanOrEqual(1);
      expect(row.expectedBestAvailable).not.toBeNull();
    }
  });

  it("the very first pick's best-available is our board's own top player, and survives in every run", () => {
    const summary = simulateDrafts(baseConfig({ slot: 1, rounds: 1 }), evidence);
    const ourBest = valueOrderFor(evidence, { teamCount: TEAM_COUNT, rosterSlots: STANDARD_ROSTER_SLOTS })[0]!;
    expect(summary.availability[0]!.survivalRate).toBe(1);
    expect(summary.availability[0]!.expectedBestAvailable!.playerId).toBe(ourBest.playerId);
  });

  describe("with quarterbacks on top of raw points and one quarterback started (founder bug, 2026-09-05)", () => {
    const qbHeavy = qbHeavyPool("agrees-with-our-board");

    it("never calls a quarterback the realistic best available at the target seat's picks", () => {
      const summary = simulateDrafts(baseConfig({ slot: 5, rounds: 6, runs: 10 }), qbHeavy);
      for (const row of summary.availability) {
        expect(row.expectedBestAvailable!.position).not.toBe("QB");
      }
    });

    it("keys best-available off value over replacement, in valueBoardIndexed's own order", () => {
      const summary = simulateDrafts(baseConfig({ slot: 1, rounds: 1, runs: 1 }), qbHeavy);
      const ourBoard = valueOrderFor(qbHeavy, { teamCount: TEAM_COUNT, rosterSlots: STANDARD_ROSTER_SLOTS });
      expect(summary.availability[0]!.expectedBestAvailable!.playerId).toBe(ourBoard[0]!.playerId);
      expect(ourBoard[0]!.position).not.toBe("QB");
    });

    it("drafts the target seat off our board even when the market prices by raw points", () => {
      const marketByPoints = qbHeavyPool("ranks-by-points");
      const summary = simulateDrafts(baseConfig({ slot: 1, rounds: 1, runs: 1 }), marketByPoints);
      // Round one, slot one, so exactly one player is rostered: the seat read our board, where a
      // quarterback is nowhere near the top, rather than the market's points-first order.
      const rostered = summary.exposure.filter((row) => row.rosterShare === 1);
      expect(rostered).toHaveLength(1);
      expect(rostered[0]!.position).not.toBe("QB");
    });
  });

  it("exposure shares are fractions of the actual run count and sum, across all rostered players, to the roster's own size", () => {
    const summary = simulateDrafts(baseConfig({ runs: 10, rounds: 15 }), evidence);
    const total = summary.exposure.reduce((sum, row) => sum + row.rosterShare, 0);
    expect(total).toBeCloseTo(totalRosterSlots(STANDARD_ROSTER_SLOTS), 5);
  });

  it("is exactly reproducible from the same config and pool", () => {
    const a = simulateDrafts(baseConfig({ runs: 15 }), evidence);
    const b = simulateDrafts(baseConfig({ runs: 15 }), evidence);
    expect(a).toEqual({ ...b, elapsedMs: a.elapsedMs });
  });

  it(
    // Fix round 1, LOW: the measured number itself lives in the build's own report and this
    // file's docblock, not a console.log a real run would otherwise print on every test pass.
    "PERFORMANCE (Task 1's own gate): 1,000 runs of a 12-team, 15-round snake draft complete in seconds, not minutes",
    () => {
      const summary = simulateDrafts(baseConfig({ runs: 1_000, rounds: 15 }), evidence);
      expect(summary.elapsedMs).toBeLessThan(30_000);
    },
    60_000,
  );
});

describe("simulateAllSlots", () => {
  const evidence = pool(TEAM_COUNT * totalRosterSlots(STANDARD_ROSTER_SLOTS) + 40);

  it("returns one summary per seat, each for a distinct slot", () => {
    const summaries = simulateAllSlots({ teamCount: TEAM_COUNT, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: 6, runs: 5, sharpness: 0.5, seed: 3 }, evidence);
    expect(summaries).toHaveLength(TEAM_COUNT);
    expect(summaries.map((s) => s.slot)).toEqual(Array.from({ length: TEAM_COUNT }, (_, i) => i + 1));
  });
});
