import { describe, expect, it } from "vitest";
import { parseInjuryCapture, readRosterBios, type InjuryCapture } from "./harvest-captures";
import { injuryHistoryFor } from "./injury-history";

function capture(iso: string, designation: string | null, description: string | null = null): InjuryCapture {
  return {
    capturedAt: new Date(iso),
    designations: designation === null ? new Map() : new Map([["p1", { designation, description }]]),
  };
}

describe("injuryHistoryFor", () => {
  it("collapses a run of the same designation into one counted, dated entry", () => {
    expect(
      injuryHistoryFor("p1", [capture("2026-08-25T12:00:00.000Z", "Q"), capture("2026-09-01T12:00:00.000Z", "Q"), capture("2026-09-05T12:00:00.000Z", "O")]),
    ).toEqual([
      { designation: "Q", description: null, firstSeenAt: "2026-08-25", lastSeenAt: "2026-09-01", captureCount: 2 },
      { designation: "O", description: null, firstSeenAt: "2026-09-05", lastSeenAt: "2026-09-05", captureCount: 1 },
    ]);
  });

  it("takes the body part from the first capture in the run that published one, and never carries it across a change", () => {
    const history = injuryHistoryFor("p1", [capture("2026-08-25T12:00:00.000Z", "Q"), capture("2026-09-01T12:00:00.000Z", "Q", "Hamstring"), capture("2026-09-05T12:00:00.000Z", "O")]);
    expect(history[0]!.description).toBe("Hamstring");
    expect(history[1]!.description).toBeNull();
  });

  it("ends a run at a capture that does not name him and starts a fresh entry after it", () => {
    expect(injuryHistoryFor("p1", [capture("2026-08-25T12:00:00.000Z", "Q"), capture("2026-09-01T12:00:00.000Z", null), capture("2026-09-05T12:00:00.000Z", "Q")]).map((r) => r.captureCount)).toEqual([1, 1]);
  });

  it("returns nothing at all for a player no capture ever named", () => {
    expect(injuryHistoryFor("nobody", [capture("2026-08-25T12:00:00.000Z", "Q")])).toEqual([]);
  });
});

describe("parseInjuryCapture", () => {
  it("reads the cheap designation list", () => {
    const parsed = parseInjuryCapture("tank01_injuries_by_date", { injDate: "20260905", injList: [{ playerID: "3129310", designation: "Q" }] }, new Date("2026-09-05T00:00:00.000Z"));
    expect(parsed.designations.get("3129310")).toEqual({ designation: "Q", description: null });
  });

  it("reads the roster sweep's designation and its body part, and skips a player the sweep says nothing about", () => {
    const payload = [
      {
        team: "KC",
        roster: [
          { playerID: "1", school: "Notre Dame", injury: { designation: "Q", description: "Hamstring" } },
          { playerID: "2", school: "Alabama", injury: { designation: "", description: "" } },
        ],
      },
    ];
    const parsed = parseInjuryCapture("tank01_injuries", payload, new Date("2026-09-05T00:00:00.000Z"));
    expect(parsed.designations.get("1")).toEqual({ designation: "Q", description: "Hamstring" });
    expect(parsed.designations.has("2")).toBe(false);
    expect(readRosterBios(payload).get("2")).toEqual({ college: "Alabama" });
  });

  it("says nothing rather than throwing on a payload it cannot read", () => {
    expect(parseInjuryCapture("tank01_injuries_by_date", { nothing: true }, new Date()).designations.size).toBe(0);
    expect(parseInjuryCapture("tank01_injuries", "not an array", new Date()).designations.size).toBe(0);
  });
});
