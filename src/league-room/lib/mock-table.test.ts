import { describe, it, expect } from "vitest";
import {
  createRequestFor,
  decodeMockTable,
  defaultMockTable,
  encodeMockTable,
  tableChips,
  withTeamCount,
  type MockTableOptions,
} from "./mock-table";

const OPTIONS: MockTableOptions = {
  teamCounts: [8, 10, 12],
  pickSeconds: [30, 60, 90],
  scoringPresets: ["half_ppr", "ppr", "standard", "te_premium"],
  rosterShapes: ["standard", "superflex"],
  defaultTeamCount: 12,
  defaultPickSeconds: 60,
  defaultScoringPreset: "half_ppr",
  defaultRosterShape: "standard",
  maxTeamNameLength: 30,
};

const LABELS = {
  scoring: new Map([
    ["half_ppr", "Half PPR"],
    ["ppr", "PPR"],
  ]),
  roster: new Map([["standard", "Standard"]]),
};

describe("decodeMockTable", () => {
  it("round-trips a stored table", () => {
    const table = { ...defaultMockTable(OPTIONS), teamCount: 10, pickSeconds: 30, draftSlot: 7, teamName: "The Herd" };
    expect(decodeMockTable(encodeMockTable(table), OPTIONS)).toEqual(table);
  });

  it("reads a missing or malformed store as the defaults", () => {
    expect(decodeMockTable(null, OPTIONS)).toEqual(defaultMockTable(OPTIONS));
    expect(decodeMockTable("{not json", OPTIONS)).toEqual(defaultMockTable(OPTIONS));
    expect(decodeMockTable("42", OPTIONS)).toEqual(defaultMockTable(OPTIONS));
  });

  it("heals any field off its offered list back to the default — a stale store never posts a refusable body", () => {
    const stored = JSON.stringify({ teamCount: 14, pickSeconds: 45, scoringPreset: "vintage", rosterShape: "dynasty", draftSlot: 3, teamName: "x" });
    const decoded = decodeMockTable(stored, OPTIONS);
    expect(decoded.teamCount).toBe(12);
    expect(decoded.pickSeconds).toBe(60);
    expect(decoded.scoringPreset).toBe("half_ppr");
    expect(decoded.rosterShape).toBe("standard");
    // The seat survives — 3 is inside the healed room.
    expect(decoded.draftSlot).toBe(3);
  });

  it("drops a seat above the room's own size and truncates an over-long name", () => {
    const stored = JSON.stringify({ teamCount: 8, draftSlot: 9, teamName: "a".repeat(99) });
    const decoded = decodeMockTable(stored, OPTIONS);
    expect(decoded.draftSlot).toBeNull();
    expect(decoded.teamName).toHaveLength(30);
  });
});

describe("withTeamCount", () => {
  it("resets a stranded seat to random rather than clamping it", () => {
    const table = { ...defaultMockTable(OPTIONS), teamCount: 12, draftSlot: 11 };
    expect(withTeamCount(table, 8).draftSlot).toBeNull();
    expect(withTeamCount(table, 12).draftSlot).toBe(11);
  });
});

describe("createRequestFor", () => {
  it("speaks the schema's own vocabulary, omitting the silent fields", () => {
    expect(createRequestFor(defaultMockTable(OPTIONS), "solo")).toEqual({
      mode: "solo",
      teamCount: 12,
      pickSeconds: 60,
      scoringPreset: "half_ppr",
      rosterShape: "standard",
    });
  });

  it("carries a chosen seat and a trimmed name when set", () => {
    const table = { ...defaultMockTable(OPTIONS), draftSlot: 4, teamName: "  The Herd  " };
    expect(createRequestFor(table, "lobby")).toMatchObject({ mode: "lobby", draftSlot: 4, teamName: "The Herd" });
  });
});

describe("tableChips", () => {
  it("renders the blueprint's sentence in order, seat random and name auto by default", () => {
    expect(tableChips(defaultMockTable(OPTIONS), LABELS).map((chip) => chip.label)).toEqual([
      "12 teams",
      "60s clock",
      "Half PPR",
      "Standard",
      "Seat: random",
      "Name: auto",
    ]);
  });

  it("names a chosen seat and shows a set name as itself", () => {
    const table = { ...defaultMockTable(OPTIONS), draftSlot: 8, teamName: "The Herd" };
    const labels = tableChips(table, LABELS).map((chip) => chip.label);
    expect(labels).toContain("Seat: 8");
    expect(labels).toContain("The Herd");
  });

  it("falls back to the raw value for a label map missing an entry rather than rendering nothing", () => {
    const table = { ...defaultMockTable(OPTIONS), scoringPreset: "te_premium", rosterShape: "superflex" };
    const labels = tableChips(table, LABELS).map((chip) => chip.label);
    expect(labels).toContain("te_premium");
    expect(labels).toContain("superflex");
  });
});
