import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { nflPlayers } from "@research-ts/db/schema";
import { NFLVERSE_SOURCE } from "./nflverse/map";
import { statLinesAsOf, statMetricName, STAT_LINE_SOURCE } from "./lines";
import { recordObservations, type PlayerWeekObservation } from "./store";

const db = createTestDb();

const KNOWN = new Date("2024-09-10T00:00:00.000Z");
const LATER = new Date("2024-09-20T00:00:00.000Z");

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(nflPlayers).values([
    { id: "p1", pfrId: "OneOn00", name: "One", position: "WR", latestTeam: "KC", rookieSeason: 2020, lastSeason: 2024 },
    { id: "p2", pfrId: "TwoTw00", name: "Two", position: "QB", latestTeam: "BUF", rookieSeason: 2019, lastSeason: 2024 },
  ]);
});

afterAll(async () => {
  await truncateAll(db);
});

function statObservation(
  playerId: string,
  metric: string,
  value: number,
  over: Partial<PlayerWeekObservation> = {},
): PlayerWeekObservation {
  return { season: 2024, week: 2, playerId, source: STAT_LINE_SOURCE, metric, value, asOf: KNOWN, ...over };
}

describe("statMetricName", () => {
  it("is the one spelling both the writer and the reader use", () => {
    expect(statMetricName("receivingYards")).toBe("receiving_yards");
    expect(statMetricName("receptions")).toBe("receptions");
  });

  it("is the source the nflverse weekly file writes under", () => {
    expect(STAT_LINE_SOURCE).toBe(NFLVERSE_SOURCE.playerWeek);
  });
});

describe("statLinesAsOf", () => {
  it("reassembles a player's week out of its component observations", async () => {
    await recordObservations(db, [
      statObservation("p1", "receptions", 6),
      statObservation("p1", "receiving_yards", 72),
      statObservation("p1", "receiving_touchdowns", 1),
    ]);

    const [line] = await statLinesAsOf(db, { season: 2024, week: 2, asOf: LATER });

    expect(line).toEqual({
      season: 2024,
      asOf: KNOWN,
      line: expect.objectContaining({ playerId: "p1", week: 2, receptions: 6, receivingYards: 72, receivingTouchdowns: 1 }),
    });
  });

  it("fills a stat nobody observed with zero — every field of a StatLine is a number", async () => {
    await recordObservations(db, [statObservation("p1", "receptions", 6)]);
    const [line] = await statLinesAsOf(db, { season: 2024, week: 2, asOf: LATER });
    expect(line?.line.passingYards).toBe(0);
  });

  it("inherits the leakage defence — a line stamped after the moment does not exist", async () => {
    await recordObservations(db, [statObservation("p1", "receptions", 6, { asOf: LATER })]);
    expect(await statLinesAsOf(db, { season: 2024, week: 2, asOf: KNOWN })).toEqual([]);
  });

  it("dates a line by its latest component, so a corrected line is dated by the correction", async () => {
    await recordObservations(db, [
      statObservation("p1", "receptions", 6),
      statObservation("p1", "receiving_yards", 72, { asOf: LATER }),
    ]);
    const [line] = await statLinesAsOf(db, { season: 2024, week: 2, asOf: LATER });
    expect(line?.asOf).toEqual(LATER);
  });

  it("ignores observations from any other source — a feature is not an outcome", async () => {
    await recordObservations(db, [
      statObservation("p1", "receptions", 6),
      statObservation("p1", "offensive_snaps", 41, { source: NFLVERSE_SOURCE.snapCounts }),
    ]);
    const [line] = await statLinesAsOf(db, { season: 2024, week: 2, asOf: LATER });
    expect(Object.values(line!.line)).not.toContain(41);
  });

  it("reads a span of weeks in week order, then player order", async () => {
    await recordObservations(db, [
      statObservation("p2", "passing_yards", 300, { week: 1 }),
      statObservation("p1", "receiving_yards", 50, { week: 1 }),
      statObservation("p1", "receiving_yards", 60, { week: 2 }),
    ]);

    const lines = await statLinesAsOf(db, { season: 2024, week: { from: 1, to: 3 }, asOf: LATER });

    expect(lines.map((row) => [row.line.week, row.line.playerId])).toEqual([[1, "p1"], [1, "p2"], [2, "p1"]]);
  });
});
