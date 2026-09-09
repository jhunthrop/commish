import { describe, expect, it } from "vitest";
import type { BoardReason } from "./board";
import {
  currentStatusFromTank01,
  isCappedRosterStatus,
  isExcludedRosterStatus,
  readActiveRosterSweep,
  readPlayerListings,
  rosterStatusFromNflverseRow,
  rosterStatusNoteOf,
  sweepIsComplete,
  type CurrentRosterStatus,
  type RosterStatusKind,
} from "./roster-status";

const SWEEP_AT = new Date("2026-09-05T12:45:00.000Z");
const LIST_AT = new Date("2026-09-05T22:35:00.000Z");

describe("rosterStatusFromNflverseRow", () => {
  it.each([
    ["ACT", "", "active", null],
    ["INA", "", "active", null],
    ["res", "", "injured_reserve", null],
    ["RES", "R01", "injured_reserve", null],
    ["RES", "r48", "injured_reserve", "designated_to_return"],
    ["RES", "R04", "pup", null],
    ["PUP", "", "pup", null],
    ["PUP", "W03", "pup", null],
    ["RES", "R05", "nfi", null],
    ["RES", "R06", "nfi", null],
    ["RES", "R27", "nfi", null],
    ["NON", "", "nfi", null],
    ["RES", "R40", "suspended", "suspended_term"],
    ["RES", "R30", "suspended", "suspended_indefinite"],
    ["RES", "R33", "suspended", "suspended_club"],
    ["SUS", "", "suspended", null],
    ["SUS", "R40", "suspended", "suspended_term"],
    ["EXE", "E02", "exempt", null],
    ["E01", "E01", "exempt", null],
    ["RES", "W03", "injured_reserve", null],
    ["RES", "R59", "injured_reserve", null],
    ["DEV", "", "practice_squad", null],
    ["CUT", "", "no_roster", null],
    ["RET", "R02", "retired", null],
  ] as const)("maps %s with detail %s to %s / %s", (code, detail, kind, expectedDetail) => {
    expect(rosterStatusFromNflverseRow(code, detail)).toEqual({ kind, detail: expectedDetail });
  });

  it("reads a code it does not know as no status, never as a guess, whatever the detail says", () => {
    expect(rosterStatusFromNflverseRow("TRC", "")).toBeNull();
    expect(rosterStatusFromNflverseRow("", "R01")).toBeNull();
  });
});

describe("the Tank01 payload readers", () => {
  it("reads the roster sweep as club membership keyed by ESPN id, counting what it enumerated", () => {
    const sweep = readActiveRosterSweep([
      { team: "KC", roster: [{ playerID: "1", espnID: "1", injury: { designation: "Questionable" } }, { playerID: "2", espnID: "2" }] },
      { team: "SF", roster: [{ espnID: "3" }] },
      { team: "BAD" },
      "not a team",
    ]);
    expect([...sweep.membersByEspnId.entries()]).toEqual([
      ["1", { team: "KC", designation: "Questionable" }],
      ["2", { team: "KC", designation: null }],
      ["3", { team: "SF", designation: null }],
    ]);
    expect(sweep.clubCount).toBe(2);
    expect(sweep.smallestClub).toBe(1);
  });

  it("reads an empty sweep from a payload that is not an array", () => {
    expect(readActiveRosterSweep({ teams: [] })).toEqual({ membersByEspnId: new Map(), clubCount: 0, smallestClub: null });
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

/** A sweep payload of `clubs` clubs, each `size` players strong, with player "1" on the first club. */
function sweepPayload(clubs: number, size: number, thinClubSize: number | null = null): unknown {
  return Array.from({ length: clubs }, (_, club) => ({
    team: `C${club}`,
    roster: Array.from({ length: club === 1 && thinClubSize !== null ? thinClubSize : size }, (_, i) => ({ espnID: club === 0 && i === 0 ? "1" : `${club}-${i}` })),
  }));
}

describe("sweepIsComplete", () => {
  it("needs every club present and none thinner than the phase's floor", () => {
    expect(sweepIsComplete(readActiveRosterSweep(sweepPayload(32, 45)), "cutdown")).toBe(true);
    expect(sweepIsComplete(readActiveRosterSweep(sweepPayload(31, 45)), "cutdown")).toBe(false);
    expect(sweepIsComplete(readActiveRosterSweep(sweepPayload(32, 45, 10)), "cutdown")).toBe(false);
    expect(sweepIsComplete(readActiveRosterSweep(sweepPayload(32, 42)), "cutdown")).toBe(false);
    expect(sweepIsComplete(readActiveRosterSweep(sweepPayload(32, 42)), "in_season")).toBe(true);
    expect(sweepIsComplete(readActiveRosterSweep([]), "in_season")).toBe(false);
  });
});

describe("currentStatusFromTank01", () => {
  const sweep = { capturedAt: SWEEP_AT, membersByEspnId: new Map([["1", { team: "KC", designation: null }]]), clubCount: 32, smallestClub: 45, complete: true };
  const sweepWithOut = { ...sweep, membersByEspnId: new Map([["1", { team: "KC", designation: "Out" }]]) };
  const listAt = LIST_AT;
  const listedOnly = { team: "NO", isFreeAgent: false, designation: null };

  it("does not read absence from a 31-club sweep as off the active roster", () => {
    const partial = { capturedAt: SWEEP_AT, ...readActiveRosterSweep(sweepPayload(31, 45)), complete: false };
    expect(currentStatusFromTank01({ espnId: "9", sweep: partial, listing: listedOnly, listAt })).toBeNull();
  });

  it("does not read absence from a 32-club sweep with one club at ten players as off the active roster, for any club", () => {
    const membership = readActiveRosterSweep(sweepPayload(32, 45, 10));
    const partial = { capturedAt: SWEEP_AT, ...membership, complete: sweepIsComplete(membership, "cutdown") };
    expect(partial.complete).toBe(false);
    expect(currentStatusFromTank01({ espnId: "9", sweep: partial, listing: { ...listedOnly, team: "C1" }, listAt })).toBeNull();
    expect(currentStatusFromTank01({ espnId: "9", sweep: partial, listing: { ...listedOnly, team: "C7" }, listAt })).toBeNull();
    // Membership of a partial sweep is still a fact; so are the list's own designation and flag.
    expect(currentStatusFromTank01({ espnId: "1", sweep: partial, listing: null, listAt })?.kind).toBe("active");
    expect(currentStatusFromTank01({ espnId: "9", sweep: partial, listing: { ...listedOnly, isFreeAgent: true }, listAt })?.kind).toBe("no_roster");
  });

  it("reads absence from a complete sweep as off the active roster", () => {
    const membership = readActiveRosterSweep(sweepPayload(32, 45));
    const complete = { capturedAt: SWEEP_AT, ...membership, complete: sweepIsComplete(membership, "cutdown") };
    expect(currentStatusFromTank01({ espnId: "9", sweep: complete, listing: listedOnly, listAt })?.kind).toBe("off_active_roster");
  });

  it("calls a man on his club's active roster active, dated by the sweep", () => {
    const status = currentStatusFromTank01({ espnId: "1", sweep, listing: null, listAt });
    expect(status).toEqual({ kind: "active", source: "tank01_roster_sweep", observedAt: SWEEP_AT, team: "KC", detail: null });
  });

  it("carries an Out designation on an active-roster man as the detail, from whichever capture is fresher", () => {
    // The sweep alone says Out.
    expect(currentStatusFromTank01({ espnId: "1", sweep: sweepWithOut, listing: null, listAt })).toEqual({ kind: "active", source: "tank01_roster_sweep", observedAt: SWEEP_AT, team: "KC", detail: "out" });
    // A fresher player list says Out over a sweep that said nothing.
    const listedOut = { team: "KC", isFreeAgent: false, designation: "Out" };
    expect(currentStatusFromTank01({ espnId: "1", sweep, listing: listedOut, listAt })?.detail).toBe("out");
    // A fresher player list that says nothing outranks the sweep's Out: the later word wins.
    expect(currentStatusFromTank01({ espnId: "1", sweep: sweepWithOut, listing: { team: "KC", isFreeAgent: false, designation: null }, listAt })?.detail).toBeNull();
    // An older list's Out does not outrank a sweep that has since said nothing.
    const olderList = new Date(SWEEP_AT.getTime() - 60_000);
    expect(currentStatusFromTank01({ espnId: "1", sweep, listing: listedOut, listAt: olderList })?.detail).toBeNull();
    // Questionable is not an absence claim.
    expect(currentStatusFromTank01({ espnId: "1", sweep, listing: { team: "KC", isFreeAgent: false, designation: "Questionable" }, listAt })?.detail).toBeNull();
  });

  it("lets a fresher player-list reserve designation outrank an older sweep membership", () => {
    const listing = { team: "KC", isFreeAgent: false, designation: "Injured Reserve - Designated to Return" };
    const status = currentStatusFromTank01({ espnId: "1", sweep, listing, listAt });
    expect(status).toEqual({ kind: "injured_reserve", source: "tank01_player_list", observedAt: LIST_AT, team: "KC", detail: "designated_to_return" });
  });

  it("reads a plain injured reserve designation with no detail", () => {
    const listing = { team: "KC", isFreeAgent: false, designation: "Injured Reserve" };
    expect(currentStatusFromTank01({ espnId: "1", sweep, listing, listAt })).toEqual({ kind: "injured_reserve", source: "tank01_player_list", observedAt: LIST_AT, team: "KC", detail: null });
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
      detail: null,
    });
    expect(currentStatusFromTank01({ espnId: "9", sweep, listing: { team: "NO", isFreeAgent: false, designation: "Questionable" }, listAt })).toEqual({
      kind: "off_active_roster",
      source: "tank01_player_list",
      observedAt: LIST_AT,
      team: "NO",
      detail: null,
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
    const status: CurrentRosterStatus = { kind: "practice_squad", source: "nflverse_roster_week_1", observedAt: LIST_AT, team: "NO", detail: null };
    const reasons: readonly BoardReason[] = [{ code: "roster_status", status: status.kind, source: status.source, observedAt: LIST_AT.toISOString(), team: "NO" }];
    expect(rosterStatusNoteOf(reasons)?.excluded).toBe(true);
    expect(rosterStatusNoteOf([{ code: "market_unlisted" }])).toBeNull();
  });
});
