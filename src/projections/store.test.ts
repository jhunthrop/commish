import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players } from "@/db/schema";
import { observationsAsOf, recordObservations, type PlayerWeekObservation } from "./store";

const db = createTestDb();

const TUESDAY = new Date("2024-09-10T12:00:00.000Z");
const WEDNESDAY = new Date("2024-09-11T12:00:00.000Z");
const SUNDAY = new Date("2024-09-15T20:00:00.000Z");

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(players).values([
    { id: "p1", name: "One", position: "WR" as const, nflTeam: "KC", headshotUrl: null },
    { id: "p2", name: "Two", position: "RB" as const, nflTeam: "BUF", headshotUrl: null },
  ]);
});

afterAll(async () => {
  await truncateAll(db);
});

function observation(over: Partial<PlayerWeekObservation> = {}): PlayerWeekObservation {
  return {
    season: 2024,
    week: 2,
    playerId: "p1",
    source: "nflverse_snap_counts",
    metric: "offensive_snaps",
    value: 41,
    asOf: TUESDAY,
    ...over,
  };
}

describe("recordObservations", () => {
  it("writes every row it is given", async () => {
    const written = await recordObservations(db, [
      observation(),
      observation({ metric: "team_offensive_snaps", value: 62 }),
      observation({ playerId: "p2", value: 33 }),
    ]);
    expect(written).toBe(3);
  });

  it("re-recording an identical fact writes nothing — an ingestion re-run is not a restatement", async () => {
    await recordObservations(db, [observation()]);
    expect(await recordObservations(db, [observation()])).toBe(0);
  });

  it("refuses a batch that states two different values for the same fact at the same as-of", async () => {
    await expect(
      recordObservations(db, [observation({ value: 41 }), observation({ value: 44 })]),
    ).rejects.toThrow(/contradict/i);
  });

  it("refuses a non-finite value rather than storing a NaN the metrics will later throw on", async () => {
    await expect(recordObservations(db, [observation({ value: Number.NaN })])).rejects.toThrow(/finite/i);
  });
});

describe("observationsAsOf — the leakage defence", () => {
  it("cannot see a row stamped after the moment being replayed", async () => {
    await recordObservations(db, [
      observation({ metric: "targets", value: 6, asOf: TUESDAY }),
      observation({ metric: "targets", value: 9, asOf: SUNDAY }),
    ]);

    const known = await observationsAsOf(db, { season: 2024, week: 2, asOf: WEDNESDAY });

    expect(known).toEqual([
      expect.objectContaining({ playerId: "p1", metric: "targets", value: 6, asOf: TUESDAY }),
    ]);
  });

  it("includes a row stamped at exactly the as-of moment — the boundary is inclusive", async () => {
    await recordObservations(db, [observation({ asOf: WEDNESDAY })]);
    const known = await observationsAsOf(db, { season: 2024, week: 2, asOf: WEDNESDAY });
    expect(known).toHaveLength(1);
  });

  it("takes the latest restatement at or before the as-of — a stat correction supersedes", async () => {
    await recordObservations(db, [
      observation({ metric: "receiving_yards", value: 55, asOf: SUNDAY }),
      observation({ metric: "receiving_yards", value: 62, asOf: new Date("2024-09-17T09:00:00.000Z") }),
    ]);

    const beforeCorrection = await observationsAsOf(db, { season: 2024, week: 2, asOf: new Date("2024-09-16T00:00:00.000Z") });
    const afterCorrection = await observationsAsOf(db, { season: 2024, week: 2, asOf: new Date("2024-09-18T00:00:00.000Z") });

    expect(beforeCorrection.map((row) => row.value)).toEqual([55]);
    expect(afterCorrection.map((row) => row.value)).toEqual([62]);
  });

  it("keeps metrics, sources and players apart rather than collapsing them together", async () => {
    await recordObservations(db, [
      observation({ metric: "offensive_snaps", value: 41 }),
      observation({ metric: "targets", value: 6 }),
      observation({ source: "tank01", metric: "targets", value: 7 }),
      observation({ playerId: "p2", metric: "targets", value: 3 }),
    ]);

    const known = await observationsAsOf(db, { season: 2024, week: 2, asOf: WEDNESDAY });

    expect(known).toHaveLength(4);
  });

  it("does not reach into another season or another week", async () => {
    await recordObservations(db, [
      observation(),
      observation({ week: 3 }),
      observation({ season: 2023 }),
    ]);
    const known = await observationsAsOf(db, { season: 2024, week: 2, asOf: WEDNESDAY });
    expect(known).toEqual([expect.objectContaining({ season: 2024, week: 2 })]);
  });

  it("reads a week range in one query, still as-of", async () => {
    await recordObservations(db, [
      observation({ week: 1, value: 10 }),
      observation({ week: 2, value: 20 }),
      observation({ week: 3, value: 30 }),
      observation({ week: 4, value: 40, asOf: SUNDAY }),
    ]);

    const known = await observationsAsOf(db, { season: 2024, week: { from: 1, to: 4 }, asOf: WEDNESDAY });

    expect(known.map((row) => [row.week, row.value])).toEqual([[1, 10], [2, 20], [3, 30]]);
  });

  it("filters to one source when asked", async () => {
    await recordObservations(db, [
      observation({ source: "nflverse_snap_counts" }),
      observation({ source: "tank01" }),
    ]);
    const known = await observationsAsOf(db, { season: 2024, week: 2, asOf: WEDNESDAY, source: "tank01" });
    expect(known.map((row) => row.source)).toEqual(["tank01"]);
  });
});
