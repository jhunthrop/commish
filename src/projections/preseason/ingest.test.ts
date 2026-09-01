import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "../nflverse/schedule";
import { HISTORICAL_ROSTER_FLOOR, ROSTER_SOURCE_CONFIG, week1RosterAsOf } from "../nflverse/rosters";
import { recordTeamObservations, type TeamWeekObservation } from "../team-store";
import { firstKickoffFor } from "./depth";
import { historicalWeek1RosterAsOf, week1RosterStampFor } from "./ingest";

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
  it("dispatches the FIXED stamp at exactly the cutover season, with no store lookup needed", async () => {
    // No rows seeded: if this incorrectly took the historical branch, `firstKickoffFor` would
    // throw on the empty store, so a passing test also proves the dispatch took the right branch.
    const stamp = await week1RosterStampFor(db, ROSTER_SOURCE_CONFIG.earliestSeason);
    expect(stamp).toEqual(week1RosterAsOf(ROSTER_SOURCE_CONFIG.earliestSeason));
  });

  it("dispatches the DERIVED stamp the season immediately before the cutover", async () => {
    const priorSeason = ROSTER_SOURCE_CONFIG.earliestSeason - 1;
    const kickoff = new Date("2020-09-11T00:20:00.000Z");
    await recordTeamObservations(db, [kickoffRow(priorSeason, kickoff)]);
    const stamp = await week1RosterStampFor(db, priorSeason);
    expect(stamp).toEqual(new Date(kickoff.getTime() - 1));
    // And NOT the fixed first-of-September this season would get from the other branch.
    expect(stamp).not.toEqual(week1RosterAsOf(priorSeason));
  });
});
