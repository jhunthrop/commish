import { describe, expect, it } from "vitest";
import { LEAGUE_CONFIG } from "@/league";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { claimMockSeatSchema, createMockRoomSchema } from "./schemas";

describe("createMockRoomSchema", () => {
  it("accepts a full body", () => {
    const parsed = createMockRoomSchema.parse({ mode: "solo", teamCount: 8, pickSeconds: 30, scoringPreset: "ppr", rosterShape: "superflex", teamName: "Sunday Rehearsal" });
    expect(parsed).toEqual({ mode: "solo", teamCount: 8, pickSeconds: 30, scoringPreset: "ppr", rosterShape: "superflex", teamName: "Sunday Rehearsal" });
  });

  it("defaults everything but the mode: { mode } is a complete request body", () => {
    const parsed = createMockRoomSchema.parse({ mode: "lobby" });
    expect(parsed).toEqual({
      mode: "lobby",
      teamCount: LEAGUE_CONFIG.defaults.teamCount,
      pickSeconds: MOCK_CONFIG.defaultPickClockSeconds,
      scoringPreset: LEAGUE_CONFIG.defaults.scoringPreset,
      rosterShape: LEAGUE_CONFIG.defaults.rosterShape,
    });
    // The defaults must themselves be members of the offered options — configs cannot drift
    // apart without this test failing.
    expect(MOCK_CONFIG.teamCountOptions).toContain(parsed.teamCount);
    expect(MOCK_CONFIG.pickClockSecondsOptions).toContain(parsed.pickSeconds);
  });

  it("refuses a team count off the offered options, naming the field", () => {
    const out = createMockRoomSchema.safeParse({ mode: "solo", teamCount: 14 });
    expect(out.success).toBe(false);
    const issue = out.error!.issues.find((entry) => entry.path[0] === "teamCount");
    expect(issue?.message).toBe("Choose 8, 10 or 12 teams.");
  });

  it("refuses a pick clock off the offered options, naming the field", () => {
    const out = createMockRoomSchema.safeParse({ mode: "solo", pickSeconds: 45 });
    expect(out.success).toBe(false);
    const issue = out.error!.issues.find((entry) => entry.path[0] === "pickSeconds");
    expect(issue?.message).toBe("Choose a 30, 60 or 90 second pick clock.");
  });

  it("refuses an unknown mode and a missing one", () => {
    expect(createMockRoomSchema.safeParse({ mode: "ladder" }).success).toBe(false);
    expect(createMockRoomSchema.safeParse({}).success).toBe(false);
  });

  it("holds the team name to the same printable, bounded rule every other name meets", () => {
    expect(createMockRoomSchema.safeParse({ mode: "solo", teamName: "   " }).success).toBe(false);
    expect(createMockRoomSchema.safeParse({ mode: "solo", teamName: "x".repeat(LEAGUE_CONFIG.maxNameLength + 1) }).success).toBe(false);
    expect(createMockRoomSchema.safeParse({ mode: "solo", teamName: "evil‮name" }).success).toBe(false);
    expect(createMockRoomSchema.parse({ mode: "solo", teamName: "  Padded  " }).teamName).toBe("Padded");
  });
});

describe("claimMockSeatSchema", () => {
  it("requires a non-blank code and trims it", () => {
    expect(claimMockSeatSchema.parse({ code: "  ABC123  " })).toEqual({ code: "ABC123" });
    expect(claimMockSeatSchema.safeParse({ code: "   " }).success).toBe(false);
    expect(claimMockSeatSchema.safeParse({}).success).toBe(false);
  });
});
