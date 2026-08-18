import { describe, it, expect } from "vitest";
import { addToQueue, moveInQueue, removeFromQueue } from "./queue";

describe("queue edits", () => {
  it("appends, and never adds the same player twice", () => {
    expect(addToQueue([], "a")).toEqual(["a"]);
    expect(addToQueue(["a"], "b")).toEqual(["a", "b"]);
    expect(addToQueue(["a", "b"], "a")).toEqual(["a", "b"]);
  });

  it("removes without disturbing the rest of the order", () => {
    expect(removeFromQueue(["a", "b", "c"], "b")).toEqual(["a", "c"]);
    expect(removeFromQueue(["a"], "zz")).toEqual(["a"]);
  });

  it("moves a player one place at a time and clamps at both ends", () => {
    expect(moveInQueue(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveInQueue(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
    expect(moveInQueue(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveInQueue(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("leaves the queue alone when the player isn't in it", () => {
    expect(moveInQueue(["a", "b"], "zz", 1)).toEqual(["a", "b"]);
  });

  it("never mutates its input", () => {
    const original = ["a", "b"];
    addToQueue(original, "c");
    removeFromQueue(original, "a");
    moveInQueue(original, "a", 1);
    expect(original).toEqual(["a", "b"]);
  });
});
