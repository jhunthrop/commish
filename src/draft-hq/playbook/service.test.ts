import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research-ts/db/client";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@research-ts/db/schema";
import { BOARD_SOURCE } from "@research-ts/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import type { BuildOutcome } from "@/draft-service/sim/types";
import { describeBuild, scarcityCurve } from "./service";

describe("describeBuild", () => {
  const RUNS = 100;
  const BASELINE = 0.25;

  it("names the label never firing, rather than dividing by zero", () => {
    const build: BuildOutcome = { label: "early-TE", runsWithLabel: 0, top3FinishRate: 0 };
    expect(describeBuild(build, RUNS, BASELINE)).toMatch(/did not emerge/);
  });

  it("states the real share, rate, its own confidence interval, and an above-baseline verdict when the interval clears the baseline", () => {
    // n=40, rate 40%: Wilson 95% CI is roughly [26%, 55%], clear of the 25% baseline.
    const build: BuildOutcome = { label: "hero-RB", runsWithLabel: 40, top3FinishRate: 0.4 };
    const sentence = describeBuild(build, RUNS, BASELINE);
    expect(sentence).toContain("40%");
    expect(sentence).toMatch(/95% confidence: \d+% to \d+%/);
    expect(sentence).toMatch(/above the 25% baseline/);
  });

  it("states a below-baseline verdict only when the interval clears the baseline on the low side", () => {
    // n=100, rate 5%: Wilson 95% CI is roughly [2%, 11%], clearly below the 25% baseline.
    const build: BuildOutcome = { label: "zero-RB", runsWithLabel: 100, top3FinishRate: 0.05 };
    const sentence = describeBuild(build, RUNS, BASELINE);
    expect(sentence).toMatch(/95% confidence: \d+% to \d+%/);
    expect(sentence).toMatch(/below the 25% baseline/);
  });

  it("fix round 1, HIGH: hedges instead of declaring a verdict when the interval straddles the baseline", () => {
    // n=20, rate 10%: Wilson 95% CI is roughly [3%, 30%] -- it straddles the 25% baseline, so
    // this sample cannot honestly call above or below.
    const build: BuildOutcome = { label: "zero-RB", runsWithLabel: 20, top3FinishRate: 0.1 };
    const sentence = describeBuild(build, RUNS, BASELINE);
    expect(sentence).toMatch(/95% confidence: \d+% to \d+%/);
    expect(sentence).toMatch(/straddles the 25% baseline/);
    expect(sentence).toMatch(/too small a sample to call/);
    expect(sentence).not.toMatch(/\babove the 25% baseline\b/);
    expect(sentence).not.toMatch(/\bbelow the 25% baseline\b/);
  });

  it("a rate landing exactly at the baseline is a straddling case too, not an 'even' verdict", () => {
    const build: BuildOutcome = { label: "late-QB", runsWithLabel: 50, top3FinishRate: 0.25 };
    const sentence = describeBuild(build, RUNS, BASELINE);
    expect(sentence).toMatch(/straddles the 25% baseline/);
    expect(sentence).not.toMatch(/even with/);
  });
});

describe("scarcityCurve", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("returns null when there is no evidence board", async () => {
    expect(await scarcityCurve(db, { teamCount: 2, rosterSlots: STANDARD_ROSTER_SLOTS }, 3)).toBeNull();
  });

  it("draws a real, declining value-over-replacement curve from the evidence board", async () => {
    const positions = ["QB", "QB", "RB", "RB", "RB", "RB"] as const;
    await db.insert(nflPlayers).values(positions.map((position, i) => ({ id: `nfl-${i}`, name: `Player ${i}`, position })));
    await db.insert(players).values(positions.map((position, i) => ({ id: `p${i}`, name: `Player ${i}`, position, nflTeam: "SF" })));
    await db.insert(playerCrosswalk).values(positions.map((_, i) => ({ playerId: `p${i}`, nflPlayerId: `nfl-${i}`, method: "espn_id", resolvedAt: new Date() })));
    const asOf = new Date("2026-08-01T00:00:00.000Z");
    // Points strictly descending by rank, so the curve is monotonically non-increasing by construction.
    await db.insert(preseasonProjections).values(
      positions.map((position, i) => ({
        season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: `nfl-${i}`, rank: i + 1, positionRank: 1, projectedPoints: 300 - i * 20,
        valueOverReplacement: 0, valueRank: i + 1, expectedGames: 17, floorPoints: 0, medianPoints: 0, ceilingPoints: 0, tier: 0, asOf,
      })),
    );

    // A 1-team, QB+RB league: teamCount 1 means round R samples overall rank R exactly.
    const shape = { teamCount: 1, rosterSlots: [{ slot: "QB" as const, count: 1, eligiblePositions: ["QB" as const] }, { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] }] };
    const curve = await scarcityCurve(db, shape, 6);
    expect(curve).not.toBeNull();
    expect(curve!.length).toBeGreaterThan(0);
    // Non-increasing: no later round is worth MORE than an earlier one.
    for (let i = 1; i < curve!.length; i += 1) {
      expect(curve![i]!.valueOverReplacement).toBeLessThanOrEqual(curve![i - 1]!.valueOverReplacement);
    }
  });
});
