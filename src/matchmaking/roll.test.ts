import { describe, expect, it } from "vitest";
import { describeStartTiming } from "./roll";

describe("describeStartTiming", () => {
  it("phrases the when-full commitment identically for a house league and a member league", () => {
    const sentence =
      "This one drafts the moment the last seat is taken. We tell you as soon as it fills, and the room opens a few minutes after that. You do not have to wait here.";
    expect(describeStartTiming({ startTrigger: "when_full", authorityKind: "house" })).toBe(sentence);
    expect(describeStartTiming({ startTrigger: "when_full", authorityKind: "member" })).toBe(sentence);
  });

  it("names no commissioner for a house league's scheduled commitment", () => {
    expect(describeStartTiming({ startTrigger: "scheduled", authorityKind: "house" })).toBe(
      "The draft starts as soon as the last seat is taken.",
    );
  });

  it("names the commissioner's own press for a member league's scheduled commitment (F11)", () => {
    expect(describeStartTiming({ startTrigger: "scheduled", authorityKind: "member" })).toBe(
      "The draft starts as soon as the last seat is taken, or when your commissioner starts it.",
    );
  });
});
