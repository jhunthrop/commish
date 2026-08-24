import { describe, expect, it } from "vitest";
import { describeStartTiming, nextKickoffAfter, ROLL_REFUSALS, roomIsFull, rollNoticeSentence } from "./roll";

describe("describeStartTiming", () => {
  it("phrases the when-full commitment identically for a house league and a member league", () => {
    const sentence =
      "This one drafts the moment the last seat is taken. We tell you as soon as it fills, and the room opens a few minutes after that. You do not have to wait here.";
    expect(describeStartTiming({ startTrigger: "when_full", authority: "house" })).toBe(sentence);
    expect(describeStartTiming({ startTrigger: "when_full", authority: "member" })).toBe(sentence);
  });

  it("names no commissioner for a house league's scheduled commitment", () => {
    expect(describeStartTiming({ startTrigger: "scheduled", authority: "house" })).toBe(
      "The draft starts as soon as the last seat is taken.",
    );
  });

  it("names the commissioner's own press for a member league's scheduled commitment (F11)", () => {
    expect(describeStartTiming({ startTrigger: "scheduled", authority: "member" })).toBe(
      "The draft starts as soon as the last seat is taken, or when your commissioner starts it.",
    );
  });
});

describe("roomIsFull", () => {
  it("is full at exactly team count", () => {
    expect(roomIsFull({ teamCount: 12, filledTeams: 12 })).toBe(true);
  });

  it("is not full with an open seat", () => {
    expect(roomIsFull({ teamCount: 12, filledTeams: 11 })).toBe(false);
  });

  it("agrees with hasOpenSeat's own negation — one rule, not two", () => {
    for (const filledTeams of [0, 1, 3, 11, 12]) {
      expect(roomIsFull({ teamCount: 12, filledTeams })).toBe(filledTeams >= 12);
    }
  });
});

describe("nextKickoffAfter", () => {
  it("rolls to the next slot in the future, not merely to the next slot", () => {
    // A process that was down for three days must not schedule a draft for yesterday. The answer
    // is a fixpoint over the cadence, the same shape `deadlineAfter` uses for the overnight pause.
    expect(nextKickoffAfter("2026-09-10T00:00:00.000Z", "2026-09-13T05:00:00.000Z")).toBe("2026-09-14T00:00:00.000Z");
  });

  it("keeps the time of day a human chose, because that is the part they planned around", () => {
    expect(nextKickoffAfter("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z")).toBe("2026-09-11T00:00:00.000Z");
  });

  it("steps exactly one cadence when now is still before the original kickoff", () => {
    // Should not happen in production (a roll only ever runs on a DUE draft), but the fixpoint's
    // own `Math.max(0, ...)` keeps it total rather than throwing on a caller that hands it a
    // still-future kickoff.
    expect(nextKickoffAfter("2026-09-10T00:00:00.000Z", "2026-09-09T00:00:00.000Z")).toBe("2026-09-11T00:00:00.000Z");
  });
});

describe("rollNoticeSentence", () => {
  it("says 'once' on the first roll", () => {
    expect(rollNoticeSentence(1)).toBe("This draft moved once because the room was not full.");
  });

  it("says 'twice' on the second roll", () => {
    expect(rollNoticeSentence(2)).toBe("This draft moved twice because the room was not full.");
  });

  it("counts honestly from the third roll onward, and never lies about the count", () => {
    expect(rollNoticeSentence(5)).toBe("This draft moved 5 times because the room was not full since it was scheduled.");
  });
});

describe("ROLL_REFUSALS", () => {
  it("names one plain-language reason per refusal, and none of them are empty", () => {
    for (const reason of Object.values(ROLL_REFUSALS)) {
      expect(typeof reason).toBe("string");
      expect(reason.length).toBeGreaterThan(0);
    }
  });
});
