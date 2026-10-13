import { describe, expect, it } from "vitest";
import {
  checkActualWins,
  checkRanges,
  checkRowCounts,
  checkSourceDates,
  parseWinTotalsCsv,
  type WinTotalRow,
} from "./validate-win-totals";

/** Two teams, one season, both fields populated, for tests that need a minimal valid CSV. */
const HEADER = "season,team,win_total,over_price,under_price,actual_wins,source,source_date";

function row(overrides: Partial<WinTotalRow> = {}): WinTotalRow {
  return {
    season: 2024,
    team: "BUF",
    winTotal: 10.5,
    overPrice: -115,
    underPrice: -105,
    actualWins: 11,
    source: "not_tracked",
    sourceDate: "2024-08-30T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseWinTotalsCsv", () => {
  it("parses a well-formed row", () => {
    const text = `${HEADER}\n2024,BUF,10.5,-115,-105,11,not_tracked,2024-08-30T00:00:00.000Z\n`;
    const rows = parseWinTotalsCsv(text);
    expect(rows).toEqual([row()]);
  });

  it("reads a blank actual_wins field as null, not zero", () => {
    const text = `${HEADER}\n2026,BUF,9.5,-110,-110,,draftkings,2026-08-15T00:00:00.000Z\n`;
    const rows = parseWinTotalsCsv(text);
    expect(rows[0]!.actualWins).toBeNull();
  });

  it("throws on an unparseable numeric column rather than coercing to NaN silently", () => {
    const text = `${HEADER}\n2024,BUF,not-a-number,-115,-105,11,not_tracked,2024-08-30T00:00:00.000Z\n`;
    expect(() => parseWinTotalsCsv(text)).toThrow();
  });
});

describe("checkRowCounts", () => {
  const teamsForSeason = (season: number): readonly string[] => (season === 2024 ? ["BUF", "MIA"] : []);

  it("passes when a season has exactly the canonical team set", () => {
    const rows = [row({ team: "BUF" }), row({ team: "MIA" })];
    expect(checkRowCounts(rows, [2024], teamsForSeason)).toEqual([]);
  });

  it("flags a season with the wrong row count", () => {
    const rows = [row({ team: "BUF" })];
    const violations = checkRowCounts(rows, [2024], teamsForSeason);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.kind).toBe("row_count");
  });

  it("flags a duplicate team code within a season", () => {
    const rows = [row({ team: "BUF" }), row({ team: "BUF" })];
    const violations = checkRowCounts(rows, [2024], teamsForSeason);
    expect(violations.some((v) => v.kind === "duplicate_team")).toBe(true);
  });

  it("flags a team code outside the canonical set for that season", () => {
    const rows = [row({ team: "BUF" }), row({ team: "OAK" })];
    const violations = checkRowCounts(rows, [2024], teamsForSeason);
    expect(violations.some((v) => v.kind === "team_set_mismatch")).toBe(true);
  });
});

describe("checkRanges", () => {
  it("passes a row with a normal win total and prices", () => {
    expect(checkRanges([row()])).toEqual([]);
  });

  it("flags a win total above 17", () => {
    const violations = checkRanges([row({ winTotal: 18 })]);
    expect(violations.some((v) => v.kind === "win_total_range")).toBe(true);
  });

  it("flags a negative win total", () => {
    const violations = checkRanges([row({ winTotal: -1 })]);
    expect(violations.some((v) => v.kind === "win_total_range")).toBe(true);
  });

  it("accepts an exact pick'em price of positive or negative 100", () => {
    expect(checkRanges([row({ overPrice: 100, underPrice: -100 })])).toEqual([]);
  });

  it("flags a price whose magnitude is under 100", () => {
    const violations = checkRanges([row({ overPrice: 50 })]);
    expect(violations.some((v) => v.kind === "price_format")).toBe(true);
  });
});

describe("checkSourceDates", () => {
  it("passes a source_date that strictly precedes the season's kickoff", () => {
    const kickoffFor = () => ({ kickoff: new Date("2024-09-05T00:00:00.000Z"), conventional: false });
    expect(checkSourceDates([row()], kickoffFor)).toEqual([]);
  });

  it("flags a source_date on or after kickoff", () => {
    const kickoffFor = () => ({ kickoff: new Date("2024-08-01T00:00:00.000Z"), conventional: false });
    const violations = checkSourceDates([row()], kickoffFor);
    expect(violations.some((v) => v.kind === "source_date_not_before_kickoff")).toBe(true);
  });

  it("flags an unparseable source_date", () => {
    const kickoffFor = () => ({ kickoff: new Date("2024-09-05T00:00:00.000Z"), conventional: false });
    const violations = checkSourceDates([row({ sourceDate: "not-a-date" })], kickoffFor);
    expect(violations.some((v) => v.kind === "source_date_unparseable")).toBe(true);
  });

  it("names the conventional-start basis in the message when no store kickoff exists", () => {
    const kickoffFor = () => ({ kickoff: new Date("2003-08-01T00:00:00.000Z"), conventional: true });
    const violations = checkSourceDates([row({ season: 2003, sourceDate: "2003-08-30T00:00:00.000Z" })], kickoffFor);
    expect(violations[0]!.message).toContain("conventional");
  });
});

describe("checkActualWins", () => {
  it("passes when actual_wins matches the expected computed value", () => {
    const expected = new Map([["2024|BUF", 11]]);
    expect(checkActualWins([row({ actualWins: 11 })], expected)).toEqual([]);
  });

  it("flags a mismatch between actual_wins and the expected value", () => {
    const expected = new Map([["2024|BUF", 12]]);
    const violations = checkActualWins([row({ actualWins: 11 })], expected);
    expect(violations.some((v) => v.kind === "actual_wins_mismatch")).toBe(true);
  });

  it("flags actual_wins missing when the season is complete and a value is expected", () => {
    const expected = new Map([["2024|BUF", 11]]);
    const violations = checkActualWins([row({ actualWins: null })], expected);
    expect(violations.some((v) => v.kind === "actual_wins_missing")).toBe(true);
  });

  it("flags actual_wins present when the season is not complete or not covered", () => {
    const expected = new Map<string, number | null>([["2024|BUF", null]]);
    const violations = checkActualWins([row({ actualWins: 11 })], expected);
    expect(violations.some((v) => v.kind === "actual_wins_unexpected")).toBe(true);
  });

  it("passes when both actual_wins and the expected value are absent", () => {
    const expected = new Map<string, number | null>([["2024|BUF", null]]);
    expect(checkActualWins([row({ actualWins: null })], expected)).toEqual([]);
  });

  it("handles a half-win tie value exactly, never rounding it away", () => {
    const expected = new Map([["2024|BUF", 8.5]]);
    expect(checkActualWins([row({ actualWins: 8.5 })], expected)).toEqual([]);
    const violations = checkActualWins([row({ actualWins: 8 })], expected);
    expect(violations.some((v) => v.kind === "actual_wins_mismatch")).toBe(true);
  });

  it("skips a row with no ground truth entry at all, rather than failing it", () => {
    const expected = new Map<string, number | null>();
    expect(checkActualWins([row({ actualWins: 999 })], expected)).toEqual([]);
  });
});

describe("no em dashes", () => {
  it("never emits an em dash in any violation message this suite produces", () => {
    const rows = [
      row({ team: "BUF" }),
      row({ team: "OAK", actualWins: null }),
      row({ winTotal: -1, overPrice: 50 }),
      row({ sourceDate: "not-a-date" }),
    ];
    const teamsForSeason = () => ["BUF", "MIA"];
    const kickoffFor = () => ({ kickoff: new Date("2024-09-05T00:00:00.000Z"), conventional: false });
    const all = [
      ...checkRowCounts(rows, [2024], teamsForSeason),
      ...checkRanges(rows),
      ...checkSourceDates(rows, kickoffFor),
      ...checkActualWins(rows, new Map()),
    ];
    for (const violation of all) {
      expect(violation.message).not.toContain("—");
    }
  });
});
