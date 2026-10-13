// src/projections/nflverse/play-callers.test.ts
import { describe, expect, it } from "vitest";
import { parsePlayCallers, playCallerLookup, validatePlayCallers } from "./play-callers";

const HEADER = "season,team,name,role,start_week,end_week,source,note";
const row = (s: string) => `${HEADER}\n${s}\n`;

describe("parsePlayCallers", () => {
  it("parses a well-formed row", () => {
    const rows = parsePlayCallers(row("2024,DET,Ben Johnson,OC,1,18,both,"));
    expect(rows).toEqual([
      { season: 2024, team: "DET", name: "Ben Johnson", role: "OC", startWeek: 1, endWeek: 18, source: "both", note: "", headCoach: "", headCoachFirstSeason: null },
    ]);
  });
  it("parses the head-coach pair when the row carries it", () => {
    const rows = parsePlayCallers(`${HEADER},head_coach,head_coach_first_season\n2026,SF,Kyle Shanahan,HC,1,18,wikipedia,,Kyle Shanahan,2017\n`);
    expect(rows[0]).toMatchObject({ headCoach: "Kyle Shanahan", headCoachFirstSeason: 2017 });
  });
  it("refuses a head coach with no first season beside him", () => {
    expect(() => parsePlayCallers(`${HEADER},head_coach,head_coach_first_season\n2026,SF,Kyle Shanahan,HC,1,18,wikipedia,,Kyle Shanahan,\n`)).toThrow(/line 2/);
  });
  it("names the team-season whose head coach the covered window is missing", () => {
    const rows = parsePlayCallers(row("2026,SF,Kyle Shanahan,HC,1,18,wikipedia,"));
    expect(validatePlayCallers(rows, [2026], () => ["SF"], () => 18, [2026])).toEqual(["SF 2026: empty head_coach."]);
    expect(validatePlayCallers(rows, [2026], () => ["SF"], () => 18)).toEqual([]);
  });
  it("throws with the line number on a malformed role", () => {
    expect(() => parsePlayCallers(row("2024,DET,Ben Johnson,QB,1,18,both,"))).toThrow(/line 2/);
  });
  it("throws with the line number on a non-numeric week", () => {
    expect(() => parsePlayCallers(row("2024,DET,Ben Johnson,OC,one,18,wikipedia,"))).toThrow(/line 2/);
  });
  it("parses a CRLF-saved CSV identically to an LF one", () => {
    const lf = row("2024,DET,Ben Johnson,OC,1,18,both,see note");
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(parsePlayCallers(crlf)).toEqual(parsePlayCallers(lf));
  });
});

describe("validatePlayCallers", () => {
  const teams = () => ["DET", "KC"];
  const finalWeek = () => 18;
  it("accepts a season fully partitioned by week ranges", () => {
    const rows = parsePlayCallers(
      `${HEADER}\n2024,DET,Ben Johnson,OC,1,18,both,\n2024,KC,Andy Reid,HC,1,9,wikipedia,\n2024,KC,Matt Nagy,OC,10,18,wikipedia,midseason change\n`,
    );
    expect(validatePlayCallers(rows, [2024], teams, finalWeek)).toEqual([]);
  });
  it("names a missing team-season", () => {
    const rows = parsePlayCallers(row("2024,DET,Ben Johnson,OC,1,18,both,"));
    expect(validatePlayCallers(rows, [2024], teams, finalWeek).join(" ")).toContain("KC 2024");
  });
  it("names a gap and an overlap in week coverage", () => {
    const rows = parsePlayCallers(
      `${HEADER}\n2024,DET,A,OC,1,8,wikipedia,\n2024,DET,B,OC,11,18,wikipedia,\n2024,KC,C,HC,1,10,wikipedia,\n2024,KC,D,OC,10,18,wikipedia,\n`,
    );
    const problems = validatePlayCallers(rows, [2024], teams, finalWeek).join(" ");
    expect(problems).toContain("DET 2024");
    expect(problems).toContain("KC 2024");
  });
  it("names a row whose start_week is after its end_week", () => {
    const rows = parsePlayCallers(row("2024,DET,Ben Johnson,OC,10,3,wikipedia,"));
    const problems = validatePlayCallers(rows, [2024], teams, finalWeek);
    expect(problems).toContain("DET 2024: start_week 10 is after end_week 3.");
  });
  it("names a row with an empty name", () => {
    const rows = parsePlayCallers(row("2024,DET,,OC,1,18,wikipedia,"));
    const problems = validatePlayCallers(rows, [2024], teams, finalWeek);
    expect(problems).toContain("DET 2024: empty name for weeks 1-18.");
  });
});

describe("playCallerLookup", () => {
  it("answers by week within a midseason change and null off the table", () => {
    const rows = parsePlayCallers(
      `${HEADER}\n2024,KC,Andy Reid,HC,1,9,wikipedia,\n2024,KC,Matt Nagy,OC,10,18,wikipedia,\n`,
    );
    const lookup = playCallerLookup(rows);
    expect(lookup("KC", 2024, 9)).toBe("Andy Reid");
    expect(lookup("KC", 2024, 10)).toBe("Matt Nagy");
    expect(lookup("KC", 2023, 1)).toBeNull();
    expect(lookup("DET", 2024, 1)).toBeNull();
  });
});
