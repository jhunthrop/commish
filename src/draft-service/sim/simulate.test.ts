import { describe, expect, it } from "vitest";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { totalRosterSlots } from "@/draft-engine";
import { BUILD_LABELS } from "./classify";
import { simulateAllSlots, simulateDrafts } from "./simulate";
import type { SimPlayerEvidence, SingleSlotSimConfig } from "./types";

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
    evidenceRank: index,
    marketRank: index, // a simple stand-in market that agrees with evidence, except where a test overrides it
    projectedPoints: Math.max(1, 300 - index * 1.2),
  }));
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

  it("the very first pick's evidence-best-available survives in every run (nobody drafts ahead of pick 1 at slot 1)", () => {
    const summary = simulateDrafts(baseConfig({ slot: 1, rounds: 1 }), evidence);
    expect(summary.availability[0]!.survivalRate).toBe(1);
    expect(summary.availability[0]!.expectedBestAvailable!.playerId).toBe(evidence[0]!.playerId);
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
    "PERFORMANCE (Task 1's own gate): 1,000 runs of a 12-team, 15-round snake draft complete in seconds, not minutes",
    () => {
      const summary = simulateDrafts(baseConfig({ runs: 1_000, rounds: 15 }), evidence);
      console.log(`[sim perf] 1,000 runs of a 12-team, 15-round snake draft: ${summary.elapsedMs}ms measured`);
      expect(summary.elapsedMs).toBeLessThan(30_000);
    },
    60_000,
  );
});

describe("simulateAllSlots", () => {
  const evidence: readonly SimPlayerEvidence[] = (() => {
    const config = baseConfig();
    const size = config.teamCount * totalRosterSlots(STANDARD_ROSTER_SLOTS) + 40;
    const plan: readonly (readonly [Position, number])[] = [
      ["QB", Math.max(30, Math.ceil(size * 0.12))],
      ["RB", Math.max(70, Math.ceil(size * 0.28))],
      ["WR", Math.max(80, Math.ceil(size * 0.32))],
      ["TE", Math.max(30, Math.ceil(size * 0.12))],
      ["K", Math.max(20, Math.ceil(size * 0.08))],
      ["DEF", Math.max(20, Math.ceil(size * 0.08))],
    ];
    const entries: { playerId: string; position: Position }[] = [];
    for (const [position, count] of plan) for (let i = 0; i < count; i += 1) entries.push({ playerId: `${position.toLowerCase()}${i + 1}`, position });
    const buckets = plan.map(([position, count]) => entries.filter((e) => e.position === position).slice(0, count));
    const ranked = buckets.flatMap((bucket, bucketIndex) => bucket.map((entry, i) => ({ entry, rank: (i + 0.5) / bucket.length, bucketIndex })));
    ranked.sort((a, b) => a.rank - b.rank || a.bucketIndex - b.bucketIndex);
    return ranked.map(({ entry }, index): SimPlayerEvidence => ({ playerId: entry.playerId, position: entry.position, evidenceRank: index, marketRank: index, projectedPoints: Math.max(1, 300 - index * 1.2) }));
  })();

  it("returns one summary per seat, each for a distinct slot", () => {
    const summaries = simulateAllSlots({ teamCount: TEAM_COUNT, rosterSlots: STANDARD_ROSTER_SLOTS, rounds: 6, runs: 5, sharpness: 0.5, seed: 3 }, evidence);
    expect(summaries).toHaveLength(TEAM_COUNT);
    expect(summaries.map((s) => s.slot)).toEqual(Array.from({ length: TEAM_COUNT }, (_, i) => i + 1));
  });
});
