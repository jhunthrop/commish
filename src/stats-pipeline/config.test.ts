import { describe, expect, it } from "vitest";
import { isIngestionMode, INGESTION_MODES, STATS_INGESTION_CONFIG } from "./config";

/** A calendar month at its longest, because the worker runs on a timer and not on an NFL calendar. */
const DAYS_PER_MONTH = 31;
/** An NFL month: four weeks plus the one that straddles the boundary. */
const WEEKS_PER_MONTH = 5;
/** A full Sunday-through-Monday slate. */
const GAMES_PER_WEEK = 16;
const MS_PER_DAY = 86_400_000;

describe("the ingestion request budget arithmetic", () => {
  it("counts a month of final-only ticking, in requests, from the shipped tunables", () => {
    // THE C1 ASSERTION, in literal numbers, because the ledger's ceiling was set against a table
    // that described a Sunday's spending while the worker actually ticks every thirty minutes for
    // thirty-one days. Every line below is what `RequestBudget.reserve()` debits, which since the
    // two-phase reservation landed is exactly what the tick spends upstream.
    const ticksPerDay = MS_PER_DAY / STATS_INGESTION_CONFIG.pollIntervalMs;
    expect(ticksPerDay).toBe(48);
    const ticksPerMonth = ticksPerDay * DAYS_PER_MONTH;
    expect(ticksPerMonth).toBe(1_488);

    // Steady state examines ONE week per tick: the week after the current one is all `scheduled`
    // games that cannot have moved, and re-listing it every thirty minutes is the single largest
    // line here for no information at all.
    //
    // The window widens to `maxWeeksPerTick` on the tick that resumes at a week with no
    // `stat_weeks` row. That is ONE tick per week rollover and not a tail, because the same tick
    // plants both rows and the tick after it is narrow again. Five a month is the upper bound: in
    // continuous operation the lookahead row is already there half the time, so the real figure is
    // nearer two or three, and over-counting here is the safe direction.
    const widenedTicksPerMonth = WEEKS_PER_MONTH;
    const scheduleCalls = ticksPerMonth + widenedTicksPerMonth * (STATS_INGESTION_CONFIG.maxWeeksPerTick - 1);
    expect(scheduleCalls).toBe(1_493);

    // `final-only` fetches each box score exactly once, ever.
    const boxScores = GAMES_PER_WEEK * WEEKS_PER_MONTH;
    expect(boxScores).toBe(80);

    // The correction sweep re-reads the most recent settled week once per calendar day for
    // `correctionWindowDays`: one schedule call plus that week's box scores, each time. A sweep
    // whose fetch list is cut short by a live week does not claim the day, so it costs its
    // schedule call and is retried; one such attempt per sweep day is allowed for here.
    const sweepDays = STATS_INGESTION_CONFIG.correctionWindowDays * WEEKS_PER_MONTH;
    const correctionSweeps = sweepDays * (1 + GAMES_PER_WEEK);
    const sweepRetries = sweepDays;
    expect(correctionSweeps).toBe(255);
    expect(sweepRetries).toBe(15);

    const ingestionPerMonth = scheduleCalls + boxScores + correctionSweeps + sweepRetries;
    expect(ingestionPerMonth).toBe(1_843);

    const ingestionCeiling = STATS_INGESTION_CONFIG.monthlyRequestBudget - STATS_INGESTION_CONFIG.reservedForBackfill;
    expect(ingestionCeiling).toBe(2_692);
    expect(ingestionPerMonth).toBeLessThan(ingestionCeiling);
    // Real headroom, not a rounding error: a month of ticking leaves nearly a third of the ceiling
    // spare for a re-listed week after a restart, an actual wedge, and a slow month.
    expect(ingestionCeiling / ingestionPerMonth).toBeGreaterThan(1.4);

    // THE PREMISE THE WHOLE TABLE RESTS ON. `trackWedge` resets only when the window opens on a
    // different week, so a `wedgedWeekTicks` below the ~336 ticks a week is legitimately unsettled
    // for would make the WIDENED window the steady state for most of the season — and a permanently
    // widened window does not fit the ceiling, as the next assertion shows. Pinning the threshold
    // to the arithmetic that depends on it is what stops the two from drifting apart again.
    const ticksPerHealthyWeek = ticksPerDay * 7;
    expect(ticksPerHealthyWeek).toBe(336);
    expect(STATS_INGESTION_CONFIG.wedgedWeekTicks).toBeGreaterThan(ticksPerHealthyWeek);

    const alwaysWidened = ticksPerMonth * STATS_INGESTION_CONFIG.maxWeeksPerTick + boxScores + correctionSweeps + sweepRetries;
    expect(alwaysWidened).toBe(3_326);
    expect(alwaysWidened).toBeGreaterThan(ingestionCeiling);

    // And the backfill fits in what is held back for it, so the two together fit the quota.
    expect(2 + 18 * (1 + GAMES_PER_WEEK)).toBe(STATS_INGESTION_CONFIG.reservedForBackfill);
    expect(ingestionPerMonth + STATS_INGESTION_CONFIG.reservedForBackfill).toBeLessThanOrEqual(
      STATS_INGESTION_CONFIG.monthlyRequestBudget,
    );
  });

  it("records why the 1,000-request free tier cannot run this cadence at all", () => {
    // The number the decision doc used to carry. A 24/7 worker at a thirty-minute cadence spends
    // more than that on schedule calls alone, before a single box score — which is the finding
    // that moved the default, and the reason `STATS_MONTHLY_REQUEST_BUDGET` has to name the
    // purchased quota rather than being left at a number nothing was measured against.
    const freeTierIngestionCeiling = 1_000 - STATS_INGESTION_CONFIG.reservedForBackfill;
    const scheduleCallsAlone = (MS_PER_DAY / STATS_INGESTION_CONFIG.pollIntervalMs) * DAYS_PER_MONTH;
    expect(freeTierIngestionCeiling).toBe(692);
    expect(scheduleCallsAlone).toBeGreaterThan(freeTierIngestionCeiling);
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
    expect(keys.budget("2026-09")).toBe("stats:budget:2026-09");
    expect(keys.finalGame("g1")).toBe("stats:game:g1:final");
    expect(keys.score("lg", 3)).toBe("score:lg:3");
    expect(keys.scoringSettings("lg")).toBe("stats:settings:lg");
    expect(keys.tickLease).toBe("stats:tick-lease");
    expect(keys.correctionSweep(3, "2026-09-15")).toBe("stats:correction:3:2026-09-15");
  });
});
