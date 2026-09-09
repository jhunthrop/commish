import { describe, expect, it } from "vitest";
import type { BoardReason } from "./board";
import {
  currentStatusFromTank01,
  isCappedRosterStatus,
  isExcludedRosterStatus,
  readActiveRosterSweep,
  readPlayerListings,
  rosterStatusFromNflverseCode,
  rosterStatusNoteOf,
  type CurrentRosterStatus,
  type RosterStatusKind,
} from "./roster-status";

const SWEEP_AT = new Date("2026-09-05T12:45:00.000Z");
const LIST_AT = new Date("2026-09-05T22:35:00.000Z");

describe("rosterStatusFromNflverseCode", () => {
  it.each([
    ["ACT", "active"],
    ["INA", "active"],
    ["res", "injured_reserve"],
    ["PUP", "pup"],
    ["NON", "nfi"],
    ["SUS", "suspended"],
    ["EXE", "exempt"],
    ["E01", "exempt"],
    ["DEV", "practice_squad"],
    ["CUT", "no_roster"],
    ["RET", "retired"],
  ] as const)("maps %s to %s", (code, kind) => {
    expect(rosterStatusFromNflverseCode(code)).toBe(kind);
  });

  it("reads a code it does not know as no status, never as a guess", () => {
    expect(rosterStatusFromNflverseCode("TRC")).toBeNull();
    expect(rosterStatusFromNflverseCode("")).toBeNull();
  });
});

describe("the Tank01 payload readers", () => {
  it("reads the roster sweep as club membership keyed by ESPN id", () => {
    const sweep = readActiveRosterSweep([
      { team: "KC", roster: [{ playerID: "1", espnID: "1", injury: { designation: "Questionable" } }, { playerID: "2", espnID: "2" }] },
      { team: "SF", roster: [{ espnID: "3" }] },
      { team: "BAD" },
      "not a team",
    ]);
    expect([...sweep.entries()]).toEqual([
      ["1", "KC"],
      ["2", "KC"],
      ["3", "SF"],
    ]);
  });

  it("reads an empty sweep from a payload that is not an array", () => {
    expect(readActiveRosterSweep({ teams: [] }).size).toBe(0);
  });

  it("reads the player list's club, free-agent flag and designation, verbatim", () => {
    const listings = readPlayerListings([
      { espnID: "1", team: "KC", isFreeAgent: "False", injury: { designation: "Injured Reserve" } },
      { espnID: "2", team: "", isFreeAgent: "True", injury: { designation: "" } },
      { playerID: "3", team: "SF" },
      { team: "NO" },
    ]);
    expect(listings.get("1")).toEqual({ team: "KC", isFreeAgent: false, designation: "Injured Reserve" });
    expect(listings.get("2")).toEqual({ team: null, isFreeAgent: true, designation: null });
    expect(listings.get("3")).toEqual({ team: "SF", isFreeAgent: false, designation: null });
    expect(listings.size).toBe(3);
  });
});

describe("currentStatusFromTank01", () => {
  const sweep = { capturedAt: SWEEP_AT, teamByEspnId: new Map([["1", "KC"]]) };
  const listAt = LIST_AT;

  it("calls a man on his club's active roster active, dated by the sweep", () => {
    const status = currentStatusFromTank01({ espnId: "1", sweep, listing: null, listAt });
    expect(status).toEqual({ kind: "active", source: "tank01_roster_sweep", observedAt: SWEEP_AT, team: "KC" });
  });

  it("lets a fresher player-list reserve designation outrank an older sweep membership", () => {
    const listing = { team: "KC", isFreeAgent: false, designation: "Injured Reserve - Designated to Return" };
    const status = currentStatusFromTank01({ espnId: "1", sweep, listing, listAt });
    expect(status).toEqual({ kind: "injured_reserve", source: "tank01_player_list", observedAt: LIST_AT, team: "KC" });
  });

  it("keeps the sweep's word when the sweep is the fresher capture", () => {
    const olderList = new Date(SWEEP_AT.getTime() - 60_000);
    const listing = { team: "KC", isFreeAgent: false, designation: "Injured Reserve" };
    const status = currentStatusFromTank01({ espnId: "1", sweep, listing, listAt: olderList });
    expect(status?.kind).toBe("active");
  });

  it.each([
    ["Physically Unable to Perform", "pup"],
    ["PUP", "pup"],
    ["Non-Football Injury", "nfi"],
    ["Suspended", "suspended"],
    ["Commissioner Exempt", "exempt"],
  ] as const)("reads the designation %s as %s", (designation, kind) => {
    const listing = { team: "SF", isFreeAgent: false, designation };
    expect(currentStatusFromTank01({ espnId: "9", sweep, listing, listAt })?.kind).toBe(kind);
  });

  it("calls a free agent no roster and a listed man off the active roster", () => {
    expect(currentStatusFromTank01({ espnId: "9", sweep, listing: { team: null, isFreeAgent: true, designation: null }, listAt })).toEqual({
      kind: "no_roster",
      source: "tank01_player_list",
      observedAt: LIST_AT,
      team: null,
    });
    expect(currentStatusFromTank01({ espnId: "9", sweep, listing: { team: "NO", isFreeAgent: false, designation: "Questionable" }, listAt })).toEqual({
      kind: "off_active_roster",
      source: "tank01_player_list",
      observedAt: LIST_AT,
      team: "NO",
    });
  });

  it("says nothing about a man neither capture names", () => {
    expect(currentStatusFromTank01({ espnId: "9", sweep, listing: null, listAt })).toBeNull();
  });
});

describe("the treatment sets", () => {
  it("caps every reserve designation and excludes every off-roster status", () => {
    const capped: readonly RosterStatusKind[] = ["injured_reserve", "pup", "nfi", "suspended", "exempt"];
    const excluded: readonly RosterStatusKind[] = ["practice_squad", "off_active_roster", "no_roster", "retired"];
    expect(capped.every(isCappedRosterStatus)).toBe(true);
    expect(excluded.every(isExcludedRosterStatus)).toBe(true);
    expect(isCappedRosterStatus("active")).toBe(false);
    expect(isExcludedRosterStatus("active")).toBe(false);
  });
});

describe("rosterStatusNoteOf", () => {
  it("reads the board's own roster_status reason back into a dated note", () => {
    const reasons: readonly BoardReason[] = [
      { code: "availability", expectedGames: 13, floorGames: 7, ceilingGames: 13 },
      { code: "roster_status", status: "injured_reserve", source: "tank01_player_list", observedAt: LIST_AT.toISOString(), team: "KC" },
    ];
    expect(rosterStatusNoteOf(reasons)).toEqual({
      status: "injured_reserve",
      source: "tank01_player_list",
      observedAt: LIST_AT.toISOString(),
      team: "KC",
      excluded: false,
    });
  });

  it("marks an off-roster status excluded and reads no note from a list without one", () => {
    const status: CurrentRosterStatus = { kind: "practice_squad", source: "nflverse_roster_week_1", observedAt: LIST_AT, team: "NO" };
    const reasons: readonly BoardReason[] = [{ code: "roster_status", status: status.kind, source: status.source, observedAt: LIST_AT.toISOString(), team: "NO" }];
    expect(rosterStatusNoteOf(reasons)?.excluded).toBe(true);
    expect(rosterStatusNoteOf([{ code: "market_unlisted" }])).toBeNull();
  });
});
