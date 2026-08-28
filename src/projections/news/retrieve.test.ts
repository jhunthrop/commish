import { describe, expect, it } from "vitest";
import type { CsvRow } from "../nflverse/csv";
import { mapInjuries, reportFiledAt, INJURY_METRICS, INJURY_SOURCE, PRACTICE_STATUS, REPORT_STATUS } from "./retrieve";

function row(over: Partial<Record<string, string>> = {}): CsvRow {
  return {
    season: "2024",
    game_type: "REG",
    team: "CLE",
    week: "3",
    gsis_id: "00-0000001",
    position: "WR",
    report_status: "Out",
    practice_status: "Did Not Participate In Practice",
    date_modified: "2024-09-20T19:05:30Z",
    ...over,
  };
}

const PROJECTED = new Set(["00-0000001"]);

describe("reportFiledAt", () => {
  it("takes the publisher's own timestamp literally, to the second", () => {
    // The only stamp in the engine not derived from a game's date, and the reason the news pass is
    // interesting at all: an injury designation is knowable BEFORE the game it describes. Rounding
    // it down to a day would leak; rounding it up would delete the feature.
    expect(reportFiledAt("2024-09-20T19:05:30Z").toISOString()).toBe("2024-09-20T19:05:30.000Z");
  });

  it("refuses a row it cannot stamp rather than guessing one", () => {
    expect(() => reportFiledAt("")).toThrow(/cannot be stamped/);
    expect(() => reportFiledAt("last Friday")).toThrow(/cannot be stamped/);
  });
});

describe("mapInjuries", () => {
  it("emits both designations as ordinals, stamped when the league filed them", () => {
    const { observations } = mapInjuries([row()], PROJECTED);
    const value = (metric: string) => observations.find((o) => o.metric === metric)!;
    expect(value(INJURY_METRICS.reportStatus).value).toBe(REPORT_STATUS.out);
    expect(value(INJURY_METRICS.practiceStatus).value).toBe(PRACTICE_STATUS.didNotParticipate);
    expect(value(INJURY_METRICS.reportStatus).source).toBe(INJURY_SOURCE);
    expect(value(INJURY_METRICS.reportStatus).asOf.toISOString()).toBe("2024-09-20T19:05:30.000Z");
  });

  it("orders the designations so a larger number is always a worse outlook", () => {
    // The only convention that reads the same at every call site.
    expect(REPORT_STATUS.out).toBeGreaterThan(REPORT_STATUS.doubtful);
    expect(REPORT_STATUS.doubtful).toBeGreaterThan(REPORT_STATUS.questionable);
    expect(PRACTICE_STATUS.didNotParticipate).toBeGreaterThan(PRACTICE_STATUS.limited);
  });

  it("records a player listed with no game status as zero, which is not the same as absent", () => {
    const { observations } = mapInjuries([row({ report_status: "" })], PROJECTED);
    expect(observations.find((o) => o.metric === INJURY_METRICS.reportStatus)!.value).toBe(REPORT_STATUS.none);
  });

  it("throws on a designation it has never seen rather than reading it as healthy", () => {
    // A silent zero would read as "no designation" for every player in the league the day the league
    // renames a status, and a news layer that had stopped seeing injuries would look exactly like a
    // news layer that had decided nobody was hurt.
    expect(() => mapInjuries([row({ report_status: "Probable" })], PROJECTED)).toThrow(/vocabulary changed/);
  });

  it("reports a player the universe does not project rather than storing him", () => {
    const { observations, unknownPlayers } = mapInjuries([row({ gsis_id: "00-0000999" })], PROJECTED);
    expect(observations).toEqual([]);
    expect(unknownPlayers).toEqual(["00-0000999"]);
  });

  it("ignores a season type this product does not score", () => {
    expect(mapInjuries([row({ game_type: "POST" })], PROJECTED).observations).toEqual([]);
  });
});
