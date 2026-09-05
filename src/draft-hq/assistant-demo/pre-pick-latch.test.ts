import { describe, expect, it } from "vitest";
import type { AssistantCallView } from "@/draft-service/assistant/call";
import { latchPrePickCalls } from "./pre-pick-latch";

function call(pickNumber: number, onTheClock: boolean): AssistantCallView {
  return { pickNumber, onTheClock, candidates: [], yourBuild: [], winningBuilds: null, computedBasis: "test" };
}

describe("latchPrePickCalls", () => {
  it("stays null until this seat's first on-the-clock call ever resolves", () => {
    const calls = [call(1, false), call(2, false)];
    expect(latchPrePickCalls(calls)).toEqual([null, null]);
  });

  it("latches the on-the-clock call the moment a later call arrives", () => {
    const onClock = call(5, true);
    const calls = [call(1, false), onClock, call(6, false)];
    expect(latchPrePickCalls(calls)).toEqual([null, null, onClock]);
  });

  it("survives every other seat's picks in between", () => {
    const onClock = call(5, true);
    const calls = [onClock, call(6, false), call(7, false), call(8, false)];
    expect(latchPrePickCalls(calls)).toEqual([null, onClock, onClock, onClock]);
  });

  it("clears the moment this seat is on the clock again", () => {
    const first = call(5, true);
    const second = call(15, true);
    const calls = [first, call(6, false), second, call(16, false)];
    expect(latchPrePickCalls(calls)).toEqual([null, first, null, second]);
  });
});
