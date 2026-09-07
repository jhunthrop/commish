import { describe, expect, it } from "vitest";
import type { PlayCallerRow } from "@/projections/nflverse/play-callers";
import { coachingFor } from "./coaching";

function row(overrides: Partial<PlayCallerRow> & Pick<PlayCallerRow, "season" | "team" | "name">): PlayCallerRow {
  return {
    role: "OC",
    startWeek: 1,
    endWeek: 18,
    source: "wikipedia",
    note: "",
    headCoach: "",
    headCoachFirstSeason: null,
    ...overrides,
  };
}

describe("coachingFor", () => {
  it("names both men and calls the head coach new only when the source says this is his first season here", () => {
    expect(
      coachingFor("NYG", 2026, [
        row({ season: 2025, team: "NYG", name: "Mike Kafka" }),
        row({ season: 2026, team: "NYG", name: "Matt Nagy", headCoach: "John Harbaugh", headCoachFirstSeason: 2026 }),
      ]),
    ).toEqual({
      season: 2026,
      headCoach: "John Harbaugh",
      headCoachIsNew: true,
      playCaller: "Matt Nagy",
      playCallerRole: "OC",
      playCallerIsNew: true,
    });
  });

  it("calls a continuing head coach and a continuing play caller not new", () => {
    const facts = coachingFor("SF", 2026, [
      row({ season: 2025, team: "SF", name: "Kyle Shanahan", role: "HC" }),
      row({ season: 2026, team: "SF", name: "Kyle Shanahan", role: "HC", headCoach: "Kyle Shanahan", headCoachFirstSeason: 2017 }),
    ]);
    expect(facts).toMatchObject({ headCoachIsNew: false, playCallerIsNew: false, playCallerRole: "HC" });
  });

  it("says we cannot tell rather than not new when the prior season names nobody", () => {
    const facts = coachingFor("SF", 2026, [row({ season: 2026, team: "SF", name: "Kyle Shanahan", role: "HC" })]);
    expect(facts).toMatchObject({ headCoach: null, headCoachIsNew: null, playCaller: "Kyle Shanahan", playCallerIsNew: null });
  });

  it("returns nothing at all for a team-season the table never covers", () => {
    expect(coachingFor("SF", 1998, [row({ season: 2026, team: "SF", name: "Kyle Shanahan" })])).toBeNull();
  });
});
