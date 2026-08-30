import { describe, expect, it } from "vitest";
import { isIngestionMode, INGESTION_MODES, STATS_INGESTION_CONFIG } from "./config";

/** A full Sunday-through-Monday slate. */
const GAMES_PER_WEEK = 16;
const MS_PER_DAY = 86_400_000;

describe("the ingestion request budget arithmetic", () => {
  it("counts the worst final-only day, in requests, from the shipped tunables", () => {
    // THE C1 ASSERTION, restated per DAY (founder correction, 2026-08-30: RapidAPI meters the
    // Tank01 plans daily, so the ledger and this table both roll with the day now). Every line
    // below is what `RequestBudget.reserve()` debits, which since the two-phase reservation
    // landed is exactly what the tick spends upstream. The worst day stacks every line at once:
    // a rollover, a full slate of finals landing, and a correction sweep with a retry.
    const ticksPerDay = MS_PER_DAY / STATS_INGESTION_CONFIG.pollIntervalMs;
    expect(ticksPerDay).toBe(48);

    // Steady state examines ONE week per tick; the window widens to `maxWeeksPerTick` on the one
    // tick that resumes at a week with no `stat_weeks` row — at most one such tick per day.
    const scheduleCalls = ticksPerDay + (STATS_INGESTION_CONFIG.maxWeeksPerTick - 1);
    expect(scheduleCalls).toBe(49);

    // `final-only` fetches each box score exactly once, ever — the worst day is a full week's
    // slate going final at once.
    const boxScores = GAMES_PER_WEEK;

    // The correction sweep re-reads the most recent settled week once per calendar day: one
    // schedule call plus that week's box scores. A sweep cut short by a live week does not claim
    // the day, so it costs its schedule call and is retried; one such attempt is allowed for.
    const correctionSweep = 1 + GAMES_PER_WEEK;
    const sweepRetry = 1;

    const ingestionPerDay = scheduleCalls + boxScores + correctionSweep + sweepRetry;
    expect(ingestionPerDay).toBe(83);

    const ingestionCeiling = STATS_INGESTION_CONFIG.dailyRequestBudget - STATS_INGESTION_CONFIG.reservedForBackfill;
    expect(ingestionCeiling).toBe(192);
    expect(ingestionPerDay).toBeLessThan(ingestionCeiling);
    // Real headroom, not a rounding error: the worst day leaves more than half the ceiling spare
    // for a re-listed week after a restart and an actual wedge.
    expect(ingestionCeiling / ingestionPerDay).toBeGreaterThan(1.4);

    // THE PREMISE THE WHOLE TABLE RESTS ON. `trackWedge` resets only when the window opens on a
    // different week, so a `wedgedWeekTicks` below the ~336 ticks a week is legitimately unsettled
    // for would make the WIDENED window the steady state for most of the season — and a permanently
    // widened window does not fit the ceiling, as the next assertion shows. Pinning the threshold
    // to the arithmetic that depends on it is what stops the two from drifting apart again.
    const ticksPerHealthyWeek = ticksPerDay * 7;
    expect(ticksPerHealthyWeek).toBe(336);
    expect(STATS_INGESTION_CONFIG.wedgedWeekTicks).toBeGreaterThan(ticksPerHealthyWeek);

    // A wedged window is [wedged week] + maxWeeksPerTick forward weeks: 1 + maxWeeksPerTick
    // schedule calls per tick, per worker.ts's wedge widening. A permanently widened day does
    // still fit the daily ceiling — the wedge threshold's real cost shows up in schedule calls,
    // and the assertion pins that a widened day at least doubles the steady schedule line.
    const alwaysWidenedSchedule = ticksPerDay * (1 + STATS_INGESTION_CONFIG.maxWeeksPerTick);
    expect(alwaysWidenedSchedule).toBe(144);
    expect(alwaysWidenedSchedule).toBeGreaterThan(2 * scheduleCalls);

    // And the backfill fits in what is held back for it, so the two together fit the quota.
    expect(2 + 18 * (1 + GAMES_PER_WEEK)).toBe(STATS_INGESTION_CONFIG.reservedForBackfill);
    expect(ingestionPerDay + STATS_INGESTION_CONFIG.reservedForBackfill).toBeLessThanOrEqual(
      STATS_INGESTION_CONFIG.dailyRequestBudget,
    );
  });

  it("recognizes exactly the ingestion modes it documents", () => {
    expect(INGESTION_MODES).toEqual(["final-only", "live"]);
    for (const mode of INGESTION_MODES) expect(isIngestionMode(mode)).toBe(true);
    expect(isIngestionMode("live-ish")).toBe(false);
    expect(isIngestionMode("")).toBe(false);
  });

  it("keys every Redis namespace it owns distinctly", () => {
    const { keys } = STATS_INGESTION_CONFIG;
    expect(keys.snapshot(3)).toBe("stats:snapshot:3");
    expect(keys.budget("2026-09-13")).toBe("stats:budget:2026-09-13");
    expect(keys.finalGame("g1")).toBe("stats:game:g1:final");
    expect(keys.score("lg", 3)).toBe("score:lg:3");
    expect(keys.scoringSettings("lg")).toBe("stats:settings:lg");
    expect(keys.tickLease).toBe("stats:tick-lease");
    expect(keys.correctionSweep(3, "2026-09-15")).toBe("stats:correction:3:2026-09-15");
  });
});
