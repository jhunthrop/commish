import { describe, it, expect } from "vitest";
import { defaultPreferences, isDraftTourDismissed } from "./preferences";

describe("defaultPreferences", () => {
  it("starts a first-timer in guided help and an experienced manager in standard", () => {
    // The column default is a floor, not the answer: the row is seeded from what the user told us
    // about themselves, so guidance is on for the person who needs it without them finding a
    // setting first, and off for the person who would find it patronizing.
    expect(defaultPreferences({ experienceTier: "beginner" })).toEqual({ helpLevel: "guided", draftTourDismissedAt: null });
    expect(defaultPreferences({ experienceTier: "experienced" }).helpLevel).toBe("standard");
  });

  it("always starts with the draft-room tour undismissed", () => {
    expect(defaultPreferences({ experienceTier: "experienced" }).draftTourDismissedAt).toBeNull();
  });
});

describe("isDraftTourDismissed", () => {
  it("is false while draftTourDismissedAt is null and true once it's stamped", () => {
    expect(isDraftTourDismissed({ helpLevel: "guided", draftTourDismissedAt: null })).toBe(false);
    expect(isDraftTourDismissed({ helpLevel: "guided", draftTourDismissedAt: "2026-08-19T00:00:00.000Z" })).toBe(true);
  });
});
