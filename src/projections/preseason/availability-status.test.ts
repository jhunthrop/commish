import { describe, expect, it } from "vitest";
import { AVAILABILITY_DESIGNATIONS, availabilityDesignationOf, availabilityStatusFor, cutdownStatusOf } from "./availability-status";
import { ROSTER_STATUS_KINDS, type CurrentRosterStatus, type RosterStatusKind, type StatusDetail } from "./roster-status";

const OBSERVED = new Date("2026-09-05T12:45:00.000Z");

function status(kind: RosterStatusKind, detail: StatusDetail | null = null): CurrentRosterStatus {
  return { kind, source: "tank01_roster_sweep", observedAt: OBSERVED, team: "GB", detail };
}

describe("cutdownStatusOf", () => {
  it.each([
    ["active", "active"],
    ["injured_reserve", "reserve"],
    ["pup", "reserve"],
    ["nfi", "reserve"],
    ["suspended", "reserve"],
    ["exempt", "reserve"],
    ["practice_squad", "practice_squad"],
    ["off_active_roster", "off_roster"],
    ["no_roster", "off_roster"],
    ["retired", "off_roster"],
  ] as const)("reads %s as the cutdown status %s", (kind, cutdown) => {
    expect(cutdownStatusOf(kind)).toBe(cutdown);
  });

  it("answers for every kind the vocabulary has", () => {
    for (const kind of ROSTER_STATUS_KINDS) expect(["active", "reserve", "practice_squad", "off_roster"]).toContain(cutdownStatusOf(kind));
  });
});

describe("availabilityStatusFor", () => {
  it("reads the resolved status when there is one: a man the fresher source shows active is not a reserve case", () => {
    expect(availabilityStatusFor(status("active", "out"), "reserve")).toBe("active");
    expect(availabilityStatusFor(status("injured_reserve"), "active")).toBe("reserve");
  });

  it("falls back to the cutdown file's own status for a man no source names", () => {
    expect(availabilityStatusFor(undefined, "reserve")).toBe("reserve");
    expect(availabilityStatusFor(undefined, "active")).toBe("active");
  });
});

describe("availabilityDesignationOf", () => {
  it.each([
    [status("active", "out"), "out"],
    [status("active"), null],
    [status("injured_reserve"), "injured_reserve"],
    [status("injured_reserve", "designated_to_return"), "injured_reserve_return"],
    [status("pup"), "pup"],
    [status("nfi"), "nfi"],
    [status("suspended", "suspended_term"), "suspended"],
    [status("suspended"), "suspended"],
    [status("exempt"), "exempt"],
    [status("practice_squad"), null],
    [status("no_roster"), null],
    [undefined, null],
  ] as const)("reads %j as the designation cell %s", (resolved, designation) => {
    expect(availabilityDesignationOf(resolved)).toBe(designation);
  });

  it("names only cells in the designation vocabulary", () => {
    for (const kind of ROSTER_STATUS_KINDS) {
      const cell = availabilityDesignationOf(status(kind));
      if (cell !== null) expect(AVAILABILITY_DESIGNATIONS).toContain(cell);
    }
  });
});
