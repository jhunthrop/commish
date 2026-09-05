import { describe, expect, it } from "vitest";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { SUPERFLEX_ROSTER_SLOTS } from "@/league/roster-shape";
import { countdownLabel, rosterShapeNote } from "./service";

describe("rosterShapeNote", () => {
  it("says nothing about an ordinary one-quarterback league", () => {
    expect(rosterShapeNote(STANDARD_ROSTER_SLOTS)).toBeNull();
  });

  it("names the real quarterback count for a superflex league, derived from the shape", () => {
    const note = rosterShapeNote(SUPERFLEX_ROSTER_SLOTS);
    expect(note).not.toBeNull();
    expect(note).toContain("2 quarterbacks");
  });

  it("counts a two-dedicated-QB shape the same way, without needing a named preset", () => {
    const twoQb = STANDARD_ROSTER_SLOTS.map((slot) => (slot.slot === "QB" ? { ...slot, count: 2 } : slot));
    expect(rosterShapeNote(twoQb)).toContain("2 quarterbacks");
  });
});

describe("countdownLabel", () => {
  const now = new Date("2026-09-04T00:00:00Z");

  it("reads in whole days when more than a day remains", () => {
    expect(countdownLabel(new Date("2026-09-13T00:00:00Z"), now)).toBe("9 days");
  });

  it("reads in whole hours under a day", () => {
    expect(countdownLabel(new Date("2026-09-04T05:00:00Z"), now)).toBe("5 hours");
  });

  it("reads 'under an hour' inside the last hour", () => {
    expect(countdownLabel(new Date("2026-09-04T00:30:00Z"), now)).toBe("under an hour");
  });

  it("never goes negative for a kickoff already in the past", () => {
    expect(countdownLabel(new Date("2026-09-01T00:00:00Z"), now)).toBe("under an hour");
  });
});
