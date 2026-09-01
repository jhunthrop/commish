import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { createNflverseClient, type NflverseClient } from "../nflverse/client";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { HISTORICAL_ROSTER_FLOOR, ROSTER_SOURCE_CONFIG, week1RosterAsOf } from "../nflverse/rosters";
import { observationsAsOf } from "../store";
import { recordTeamObservations, type TeamWeekObservation } from "../team-store";
import { recordNflPlayers } from "../universe";
import { DEPTH_SOURCE, firstKickoffFor } from "./depth";
import { historicalWeek1RosterAsOf, ingestDepthCharts, week1RosterStampFor } from "./ingest";

/**
 * THE DERIVATION LAYER ITSELF, pinned directly rather than only through what it produces.
 *
 * `rosters.test.ts` and `store.test.ts` both hand-construct a `Date` and prove `mapWeek1Rosters` /
 * `preseasonRostersAsOf` honour whatever `asOf` they are given — the right thing for those modules
 * to prove, since neither one derives the stamp itself. Neither test exercises the derivation:
 * `historicalWeek1RosterAsOf` reading the season's own first kickoff out of the store, or
 * `week1RosterStampFor` choosing between it and the fixed stamp. This file is that missing layer.
 */

const db = createTestDb();

function kickoffRow(season: number, asOf: Date, overrides: Partial<TeamWeekObservation> = {}): TeamWeekObservation {
  return {
    season,
    week: 1,
    team: "BUF",
    source: SCHEDULE_SOURCE.kickoff,
    // The UNCONDITIONAL marker (fix round, I4/I5) — `firstKickoffFor` no longer reads `pointSpread`,
    // a stamp that can legitimately be missing for a real scheduled game.
    metric: SCHEDULE_METRICS.kickoffInstant,
    value: 1,
    asOf,
    ...overrides,
  };
}

beforeEach(async () => {
  await truncateAll(db);
});

describe("historicalWeek1RosterAsOf", () => {
  it("stamps EXACTLY one millisecond before the season's own first kickoff, read from the store", async () => {
    const kickoff = new Date("2015-09-11T00:30:00.000Z");
    await recordTeamObservations(db, [
      kickoffRow(2015, kickoff),
      // A later game the same opening week — the derivation must take the EARLIEST kickoff, not any
      // one row, so this has to be present and has to be ignored.
      kickoffRow(2015, new Date(kickoff.getTime() + 3_600_000), { team: "DAL", value: 3 }),
    ]);
    const stamp = await historicalWeek1RosterAsOf(db, 2015);
    const expected = await firstKickoffFor(db, 2015);
    expect(stamp).toEqual(new Date(expected.getTime() - 1));
    expect(stamp).toEqual(new Date(kickoff.getTime() - 1));
  });

  it("REFUSES a season below HISTORICAL_ROSTER_FLOOR, with no store lookup needed to know that", async () => {
    await expect(historicalWeek1RosterAsOf(db, HISTORICAL_ROSTER_FLOOR - 1)).rejects.toThrow(
      new RegExp(`not backfilled before ${HISTORICAL_ROSTER_FLOOR}`),
    );
  });

  it("names the context command when the store holds no kickoff instants for the season", async () => {
    // No `recordTeamObservations` call above this line — the store is empty for 2015, so
    // `firstKickoffFor` (which this function reads through, unwrapped) has to refuse rather than
    // derive a stamp from nothing, and the message has to tell an operator what to run.
    await expect(historicalWeek1RosterAsOf(db, 2015)).rejects.toThrow(/projections:context/);
  });
});

describe("week1RosterStampFor", () => {
  // A `fetchedAt` long after any archive's own first of September, so these two dispatch tests are
  // unaffected by the Task 3 bound and continue to pin the DISPATCH itself.
  const FETCHED_LONG_AFTER = new Date("2026-09-01T12:00:00.000Z");

  it("dispatches the FIXED stamp at exactly the cutover season, with no store lookup needed", async () => {
    // No rows seeded: if this incorrectly took the historical branch, `firstKickoffFor` would
    // throw on the empty store, so a passing test also proves the dispatch took the right branch.
    const stamp = await week1RosterStampFor(db, ROSTER_SOURCE_CONFIG.earliestSeason, FETCHED_LONG_AFTER);
    expect(stamp).toEqual(week1RosterAsOf(ROSTER_SOURCE_CONFIG.earliestSeason));
  });

  it("dispatches the DERIVED stamp the season immediately before the cutover", async () => {
    const priorSeason = ROSTER_SOURCE_CONFIG.earliestSeason - 1;
    const kickoff = new Date("2020-09-11T00:20:00.000Z");
    await recordTeamObservations(db, [kickoffRow(priorSeason, kickoff)]);
    const stamp = await week1RosterStampFor(db, priorSeason, FETCHED_LONG_AFTER);
    expect(stamp).toEqual(new Date(kickoff.getTime() - 1));
    // And NOT the fixed first-of-September this season would get from the other branch.
    expect(stamp).not.toEqual(week1RosterAsOf(priorSeason));
  });

  it("BOUNDS the fixed-stamp branch by fetchedAt (Task 3, ruling C) — a season fetched before its own convention date", async () => {
    const fetchedAt = new Date("2026-08-20T15:00:00.000Z");
    const stamp = await week1RosterStampFor(db, 2026, fetchedAt);
    expect(stamp).toEqual(fetchedAt);
    expect(stamp.getTime()).toBeLessThan(week1RosterAsOf(2026).getTime());
  });

  it("does NOT bound the DERIVED (historical) branch — that stamp never reads fetchedAt at all", async () => {
    const priorSeason = ROSTER_SOURCE_CONFIG.earliestSeason - 1;
    const kickoff = new Date("2020-09-11T00:20:00.000Z");
    await recordTeamObservations(db, [kickoffRow(priorSeason, kickoff)]);
    // A fetchedAt absurdly early — if it leaked into the historical branch's own derivation it would
    // move the stamp; it must not, because that branch reads the season's own kickoff, never a clock.
    const stamp = await week1RosterStampFor(db, priorSeason, new Date("2000-01-01T00:00:00.000Z"));
    expect(stamp).toEqual(new Date(kickoff.getTime() - 1));
  });
});

describe("ingestDepthCharts's cutoff (Task 3, ruling B — min(now, firstKickoff - 1ms))", () => {
  const SEASON = 2026;
  const KICKOFF = new Date("2026-09-04T23:20:00.000Z");
  const PLAYER_ID = "00-0000001";
  const FAR_FUTURE = new Date("9999-12-31T00:00:00.000Z");

  function datedDepthChartCsv(dt: string): string {
    const header =
      "dt,team,player_name,espn_id,gsis_id,pos_grp_id,pos_grp,pos_id,pos_name,pos_abb,pos_slot,pos_rank";
    const row = `${dt},BUF,Vera Veteran,1,${PLAYER_ID},15,3WR 1TE,9,Wide Receiver,WR,9,1`;
    return `${header}\n${row}\n`;
  }

  function fakeClient(csv: string): NflverseClient {
    return createNflverseClient({
      fetch: (async () => new Response(csv, { status: 200 })) as typeof globalThis.fetch,
    });
  }

  beforeEach(async () => {
    await recordNflPlayers(db, [
      { id: PLAYER_ID, espnId: null, pfrId: "Vete01", name: "Vera Veteran", position: "WR", latestTeam: "BUF", rookieSeason: 2020, lastSeason: 2025 },
    ]);
    await recordTeamObservations(db, [kickoffRow(SEASON, KICKOFF)]);
  });

  it("cutoff is `now` when now is strictly before firstKickoff - 1ms — a live/future season", async () => {
    const now = new Date("2026-08-25T12:00:00.000Z"); // strictly before KICKOFF - 1ms
    const dt = "2026-08-20T00:00:00Z"; // before `now`, so within the cutoff
    const clock: Clock = { now: () => now.toISOString() };

    const report = await ingestDepthCharts(db, SEASON, fakeClient(datedDepthChartCsv(dt)), clock);
    expect(report.asOf).toEqual(now);

    // And the wiring end-to-end: the WRITTEN row is stamped at the snapshot's own dt (ruling B),
    // never at the cutoff `now` this test also asserts on above.
    const rows = await observationsAsOf(db, { season: SEASON, week: 1, asOf: FAR_FUTURE, source: DEPTH_SOURCE });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.asOf).toEqual(new Date(dt));
  });

  it("cutoff falls back to firstKickoff - 1ms when now is at or after it — an already-started season, byte-identical to before", async () => {
    const now = new Date(KICKOFF.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days after kickoff
    const dt = "2026-08-20T00:00:00Z";
    const clock: Clock = { now: () => now.toISOString() };

    const report = await ingestDepthCharts(db, SEASON, fakeClient(datedDepthChartCsv(dt)), clock);
    expect(report.asOf).toEqual(new Date(KICKOFF.getTime() - 1));
    expect(report.asOf.getTime()).not.toBe(now.getTime());
  });

  /**
   * M4 (fix round review) — I1 and ruling B COMPOSED, not just each proven in isolation. A later
   * week's kickoff row, stamped EARLIER than week one's own, sits in the store alongside week one's;
   * the after-kickoff cutoff must still resolve from WEEK ONE's real kickoff (via the now
   * week-scoped `firstKickoffFor`), not silently drift to the earlier, later-week stamp the pre-I1
   * query would have picked.
   */
  it("the after-kickoff cutoff still resolves from WEEK ONE's kickoff when a later week's row is stamped earlier (I1 x ruling B)", async () => {
    const earlierLaterWeekStamp = new Date(KICKOFF.getTime() - 3 * 24 * 60 * 60 * 1000);
    await recordTeamObservations(db, [kickoffRow(SEASON, earlierLaterWeekStamp, { week: 6, team: "CLE" })]);

    const now = new Date(KICKOFF.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days after kickoff
    const dt = "2026-08-20T00:00:00Z";
    const clock: Clock = { now: () => now.toISOString() };

    const report = await ingestDepthCharts(db, SEASON, fakeClient(datedDepthChartCsv(dt)), clock);
    expect(report.asOf).toEqual(new Date(KICKOFF.getTime() - 1));
    expect(report.asOf.getTime()).not.toBe(earlierLaterWeekStamp.getTime() - 1);
  });
});
