import { describe, expect, it } from "vitest";
import type { EventReactionMap } from "./stream-reactions";
import { applyEventReaction, isReactableKind, parseStreamReactionFrame } from "./stream-reactions";

const EMPTY: EventReactionMap = new Map();

function frame(payload: unknown, type = "stream.reaction"): string {
  return JSON.stringify({ type, payload });
}

describe("isReactableKind", () => {
  it("takes the three a person did and nothing else", () => {
    expect(["pick", "claim", "trade"].map((kind) => isReactableKind(kind as "pick"))).toEqual([true, true, true]);
    expect(["join", "lineup", "money", "system", "league"].map((kind) => isReactableKind(kind as "join"))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe("applyEventReaction", () => {
  it("adds, and a redelivered add stays one entry", () => {
    const once = applyEventReaction(EMPTY, { eventId: "e1", emoji: "🔥", userId: "u1", action: "added" });
    const twice = applyEventReaction(once, { eventId: "e1", emoji: "🔥", userId: "u1", action: "added" });
    expect(twice.get("e1")).toEqual([{ emoji: "🔥", userId: "u1" }]);
  });

  it("removes, and a removal for something already gone leaves no key behind", () => {
    const added = applyEventReaction(EMPTY, { eventId: "e1", emoji: "🔥", userId: "u1", action: "added" });
    const removed = applyEventReaction(added, { eventId: "e1", emoji: "🔥", userId: "u1", action: "removed" });
    expect(removed.has("e1")).toBe(false);
    const again = applyEventReaction(removed, { eventId: "e1", emoji: "🔥", userId: "u1", action: "removed" });
    expect(again.has("e1")).toBe(false);
  });

  it("keeps other people's reactions on the same event", () => {
    const mine = applyEventReaction(EMPTY, { eventId: "e1", emoji: "🔥", userId: "u1", action: "added" });
    const theirs = applyEventReaction(mine, { eventId: "e1", emoji: "🔥", userId: "u2", action: "added" });
    const minePulled = applyEventReaction(theirs, { eventId: "e1", emoji: "🔥", userId: "u1", action: "removed" });
    expect(minePulled.get("e1")).toEqual([{ emoji: "🔥", userId: "u2" }]);
  });

  it("never mutates the map it was given", () => {
    const held = applyEventReaction(EMPTY, { eventId: "e1", emoji: "🔥", userId: "u1", action: "added" });
    applyEventReaction(held, { eventId: "e2", emoji: "👏", userId: "u2", action: "added" });
    expect(held.has("e2")).toBe(false);
  });
});

describe("parseStreamReactionFrame", () => {
  it("reads a well-formed frame", () => {
    expect(parseStreamReactionFrame(frame({ eventId: "e1", emoji: "🔥", userId: "u1", action: "added" }))).toEqual({
      eventId: "e1",
      emoji: "🔥",
      userId: "u1",
      action: "added",
    });
  });

  it("answers null for anything it cannot trust", () => {
    expect(parseStreamReactionFrame("not json")).toBeNull();
    expect(parseStreamReactionFrame("null")).toBeNull();
    expect(parseStreamReactionFrame(frame({ eventId: "e1", emoji: "🔥", userId: "u1", action: "added" }, "chat.reaction"))).toBeNull();
    expect(parseStreamReactionFrame(JSON.stringify({ type: "stream.reaction", payload: "nope" }))).toBeNull();
    expect(parseStreamReactionFrame(frame({ emoji: "🔥", userId: "u1", action: "added" }))).toBeNull();
    expect(parseStreamReactionFrame(frame({ eventId: "e1", userId: "u1", action: "added" }))).toBeNull();
    expect(parseStreamReactionFrame(frame({ eventId: "e1", emoji: "🔥", action: "added" }))).toBeNull();
    expect(parseStreamReactionFrame(frame({ eventId: "e1", emoji: "🔥", userId: "u1", action: "shrugged" }))).toBeNull();
  });
});
