import { describe, expect, it } from "vitest";
import {
  DOUBTFUL_REPORT_STATUS,
  SUSPENSION_ROSTER_STATUSES,
  SUSPENSION_STATUS_DETAILS,
  UNAVAILABLE_REPORT_STATUSES,
  UNAVAILABLE_ROSTER_STATUSES,
  classifySeasonWeeks,
  classifyWeek,
  isSuspendedRosterWeek,
  isUnavailableRosterStatus,
  type RosteredWeek,
} from "./week-classification";

function week(overrides: Partial<RosteredWeek> = {}): RosteredWeek {
  return { week: 5, rosterStatus: "ACT", rosterStatusDetail: "", reportStatus: null, played: false, ...overrides };
}

describe("classifyWeek", () => {
  it("calls a week he played 'played' whatever the roster or the report said that week", () => {
    expect(classifyWeek(week({ played: true }))).toBe("played");
    expect(classifyWeek(week({ played: true, rosterStatus: "RES" }))).toBe("played");
    expect(classifyWeek(week({ played: true, reportStatus: "Out" }))).toBe("played");
    expect(classifyWeek(week({ played: true, rosterStatus: "INA", reportStatus: "Doubtful" }))).toBe("played");
    expect(classifyWeek(week({ played: true, rosterStatus: "SUS" }))).toBe("played");
  });

  it.each([...UNAVAILABLE_REPORT_STATUSES])("calls an unplayed week with an '%s' report unavailable", (reportStatus) => {
    expect(classifyWeek(week({ reportStatus }))).toBe("unavailable");
    expect(classifyWeek(week({ reportStatus, rosterStatus: "INA" }))).toBe("unavailable");
  });

  it("calls Doubtful-and-did-not-play unavailable", () => {
    expect(classifyWeek(week({ reportStatus: DOUBTFUL_REPORT_STATUS }))).toBe("unavailable");
  });

  it.each([...UNAVAILABLE_ROSTER_STATUSES])("calls an unplayed week on the %s list unavailable, report or no report", (rosterStatus) => {
    expect(classifyWeek(week({ rosterStatus }))).toBe("unavailable");
    expect(classifyWeek(week({ rosterStatus, reportStatus: "" }))).toBe("unavailable");
  });

  it("calls a numbered exemption unavailable without listing every number", () => {
    expect(isUnavailableRosterStatus("E01")).toBe(true);
    expect(isUnavailableRosterStatus("E14")).toBe(true);
    expect(classifyWeek(week({ rosterStatus: "E14" }))).toBe("unavailable");
  });

  it("reads the codes case-insensitively and trimmed, the way the release sometimes spells them", () => {
    expect(isUnavailableRosterStatus(" res ")).toBe(true);
    expect(classifyWeek(week({ reportStatus: "out" }))).toBe("unavailable");
    expect(classifyWeek(week({ rosterStatus: "res", rosterStatusDetail: " r40 " }))).toBe("suspended");
  });

  it.each(["ACT", "INA", "DEV", "CUT", "RET", "TRC", "TRD", "TRT", "RSN", "NWT", "RSR", "UFA", "RFA", "UDF"])(
    "calls an unplayed %s week with no designation a did-not-play week: a role fact, never an absence",
    (rosterStatus) => {
      expect(classifyWeek(week({ rosterStatus }))).toBe("did_not_play");
      expect(classifyWeek(week({ rosterStatus, reportStatus: "" }))).toBe("did_not_play");
    },
  );

  it.each(["Questionable", "Probable", "", "Note"])("does not call an unplayed week with a '%s' report an absence", (reportStatus) => {
    expect(classifyWeek(week({ reportStatus }))).toBe("did_not_play");
  });

  describe("a served suspension is not an injury (founder report 2026-09-08)", () => {
    it.each([...SUSPENSION_ROSTER_STATUSES])("calls an unplayed week under the coarse %s code suspended: the only signal the 2013-2020 files carry", (rosterStatus) => {
      expect(classifyWeek(week({ rosterStatus }))).toBe("suspended");
      expect(classifyWeek(week({ rosterStatus, rosterStatusDetail: "A01" }))).toBe("suspended");
      expect(SUSPENSION_ROSTER_STATUSES.has("SUS")).toBe(true);
      expect(UNAVAILABLE_ROSTER_STATUSES.has("SUS")).toBe(false);
    });

    it.each([...SUSPENSION_STATUS_DETAILS])("calls an unplayed reserve week whose detail is %s suspended: how the 2021-2025 files spell it", (detail) => {
      expect(classifyWeek(week({ rosterStatus: "RES", rosterStatusDetail: detail }))).toBe("suspended");
      expect(isSuspendedRosterWeek("RES", detail)).toBe(true);
    });

    it("names the three measured detail codes: by the commissioner for a term, indefinitely, by the club", () => {
      expect([...SUSPENSION_STATUS_DETAILS].sort()).toEqual(["R30", "R33", "R40"]);
    });

    it("keeps an injured-reserve week (R01, R48), PUP (R04) and a non-football injury (R05) unavailable", () => {
      for (const detail of ["R01", "R48", "R04", "R05", ""]) expect(classifyWeek(week({ rosterStatus: "RES", rosterStatusDetail: detail }))).toBe("unavailable");
    });

    it("reads the detail even under a game-day inactive code: the detail is the fact", () => {
      expect(classifyWeek(week({ rosterStatus: "INA", rosterStatusDetail: "R40" }))).toBe("suspended");
    });

    it("outranks the injury report: a suspended man's health that week is moot", () => {
      expect(classifyWeek(week({ rosterStatus: "SUS", reportStatus: "Out" }))).toBe("suspended");
      expect(classifyWeek(week({ rosterStatus: "RES", rosterStatusDetail: "R40", reportStatus: "Doubtful" }))).toBe("suspended");
    });

    it("never outranks a played week", () => {
      expect(classifyWeek(week({ played: true, rosterStatus: "RES", rosterStatusDetail: "R40" }))).toBe("played");
    });
  });
});

describe("classifySeasonWeeks", () => {
  const rosterRows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18].map((week) => ({ week, status: "ACT", statusDetail: "" }));

  it("splits a healthy backup's season into played weeks and did-not-play weeks, with nothing unavailable", () => {
    const classes = classifySeasonWeeks({
      rosterRows,
      injuryRows: [{ week: 16, reportStatus: "", primaryInjury: "" }],
      gamesPlayedWeeks: [3, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18],
    });
    expect(classes).toEqual({
      playedWeeks: [3, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18],
      unavailableWeeks: [],
      suspendedWeeks: [],
      didNotPlayWeeks: [1, 2, 4, 5, 6, 7],
    });
  });

  it("dates every unavailable week from the report and the roster together", () => {
    const classes = classifySeasonWeeks({
      rosterRows: [
        { week: 1, status: "ACT", statusDetail: "" },
        { week: 2, status: "ACT", statusDetail: "" },
        { week: 3, status: "INA", statusDetail: "" },
        { week: 4, status: "RES", statusDetail: "" },
        { week: 5, status: "RES", statusDetail: "" },
        { week: 6, status: "ACT", statusDetail: "" },
      ],
      injuryRows: [
        { week: 3, reportStatus: "Out", primaryInjury: "Knee" },
        { week: 6, reportStatus: "Questionable", primaryInjury: "Knee" },
      ],
      gamesPlayedWeeks: [1, 2],
    });
    expect(classes).toEqual({ playedWeeks: [1, 2], unavailableWeeks: [3, 4, 5], suspendedWeeks: [], didNotPlayWeeks: [6] });
  });

  it("keeps a suspension apart from the injury weeks: Rashee Rice, 2025", () => {
    // RES/R40 weeks 1-6 (a six-game suspension), active 7-15, INA+Out week 16, RES/R01 17-18 (a knee); bye week 10.
    const rosterRows2025 = [
      ...[1, 2, 3, 4, 5, 6].map((week) => ({ week, status: "RES", statusDetail: "R40" })),
      ...[7, 8, 9, 11, 12, 13, 14, 15].map((week) => ({ week, status: "ACT", statusDetail: "A01" })),
      { week: 16, status: "INA", statusDetail: "A01" },
      { week: 17, status: "RES", statusDetail: "R01" },
      { week: 18, status: "RES", statusDetail: "R01" },
    ];
    const classes = classifySeasonWeeks({
      rosterRows: rosterRows2025,
      injuryRows: [{ week: 16, reportStatus: "Out", primaryInjury: "Knee" }],
      gamesPlayedWeeks: [7, 8, 9, 11, 12, 13, 14, 15],
    });
    expect(classes).toEqual({
      playedWeeks: [7, 8, 9, 11, 12, 13, 14, 15],
      unavailableWeeks: [16, 17, 18],
      suspendedWeeks: [1, 2, 3, 4, 5, 6],
      didNotPlayWeeks: [],
    });
  });

  it("counts a played week the roster file never listed, and never invents a week neither source holds", () => {
    const classes = classifySeasonWeeks({ rosterRows: [{ week: 2, status: "ACT", statusDetail: "" }], injuryRows: [], gamesPlayedWeeks: [1, 2] });
    expect(classes).toEqual({ playedWeeks: [1, 2], unavailableWeeks: [], suspendedWeeks: [], didNotPlayWeeks: [] });
  });

  it("does not turn a bare injury row into a rostered week", () => {
    // A report row with no roster row and no played week is a designation about a week the census
    // never carried him for: nothing to classify.
    const classes = classifySeasonWeeks({ rosterRows: [], injuryRows: [{ week: 4, reportStatus: "Out", primaryInjury: "" }], gamesPlayedWeeks: [] });
    expect(classes).toEqual({ playedWeeks: [], unavailableWeeks: [], suspendedWeeks: [], didNotPlayWeeks: [] });
  });

  it("returns weeks in ascending order whatever order the rows arrived in", () => {
    const classes = classifySeasonWeeks({
      rosterRows: [
        { week: 9, status: "RES", statusDetail: "" },
        { week: 1, status: "ACT", statusDetail: "" },
        { week: 4, status: "PUP", statusDetail: "" },
        { week: 7, status: "SUS", statusDetail: "" },
        { week: 3, status: "RES", statusDetail: "R40" },
      ],
      injuryRows: [],
      gamesPlayedWeeks: [1],
    });
    expect(classes.unavailableWeeks).toEqual([4, 9]);
    expect(classes.suspendedWeeks).toEqual([3, 7]);
  });
});
