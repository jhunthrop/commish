import { describe, it, expect } from "vitest";
import { CHAT_CONFIG } from "./config";
import type { ChatMessageView } from "./contract";
import { applyReaction, mergeMessages, summarizeReactions, unionMessages } from "./messages";

function message(id: string, overrides: Partial<ChatMessageView> = {}): ChatMessageView {
  return {
    id,
    authorUserId: "u1",
    authorName: "Alex Rivera",
    authorAvatarUrl: null,
    body: `message ${id}`,
    createdAt: "2026-08-18T12:00:00.000Z",
    reactions: [],
    gif: null,
    ...overrides,
  };
}

describe("mergeMessages", () => {
  it("orders by id, oldest first, regardless of arrival order", () => {
    const merged = mergeMessages([message("3")], [message("1"), message("2")]);
    expect(merged.map((m) => m.id)).toEqual(["1", "2", "3"]);
  });

  it("replaces a message with the same id instead of duplicating it", () => {
    const merged = mergeMessages([message("1", { body: "old" })], [message("1", { body: "new" })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.body).toBe("new");
  });

  it("keeps reactions already folded when a replayed frame arrives with none", () => {
    const held = [message("1", { reactions: [{ emoji: "🔥", userId: "u2" }] })];
    const merged = mergeMessages(held, [message("1")]);
    expect(merged[0]?.reactions).toEqual([{ emoji: "🔥", userId: "u2" }]);
  });

  it("dedupes an identical reaction arriving from both sides", () => {
    const held = [message("1", { reactions: [{ emoji: "🔥", userId: "u2" }] })];
    const merged = mergeMessages(held, [message("1", { reactions: [{ emoji: "🔥", userId: "u2" }] })]);
    expect(merged[0]?.reactions).toHaveLength(1);
  });

  it("drops the oldest messages once the held buffer is full", () => {
    const many = Array.from({ length: CHAT_CONFIG.maxHeldMessages + 2 }, (_, i) => message(String(i + 1)));
    const merged = mergeMessages([], many);
    expect(merged).toHaveLength(CHAT_CONFIG.maxHeldMessages);
    expect(merged[0]?.id).toBe("3");
  });
});

/**
 * The same fold WITHOUT the cap — what a refetch of the newest page goes through, so a
 * reconnect can't re-trim a buffer backward pagination deliberately grew past the cap.
 */
describe("unionMessages", () => {
  it("keeps everything, past the buffer cap", () => {
    const many = Array.from({ length: CHAT_CONFIG.maxHeldMessages + 2 }, (_, i) => message(String(i + 1)));
    const united = unionMessages([], many);
    expect(united).toHaveLength(CHAT_CONFIG.maxHeldMessages + 2);
    expect(united[0]?.id).toBe("1");
  });

  it("orders and dedupes exactly as the capped fold does", () => {
    const united = unionMessages([message("2", { body: "held" })], [message("1"), message("2", { body: "fresher" })]);
    expect(united.map((entry) => entry.id)).toEqual(["1", "2"]);
    expect(united[1]?.body).toBe("fresher");
  });

  it("unions reactions rather than letting a replayed empty list erase them", () => {
    const held = [message("1", { reactions: [{ emoji: "🔥", userId: "u2" }] })];
    const united = unionMessages(held, [message("1", { reactions: [] })]);
    expect(united[0]?.reactions).toEqual([{ emoji: "🔥", userId: "u2" }]);
  });
});

describe("applyReaction", () => {
  it("adds a reaction to the named message only", () => {
    const held = [message("1"), message("2")];
    const next = applyReaction(held, { messageId: "2", emoji: "🔥", userId: "u2", action: "added" });
    expect(next[0]?.reactions).toEqual([]);
    expect(next[1]?.reactions).toEqual([{ emoji: "🔥", userId: "u2" }]);
  });

  it("is idempotent — a redelivered add never double-counts", () => {
    const once = applyReaction([message("1")], { messageId: "1", emoji: "🔥", userId: "u2", action: "added" });
    const twice = applyReaction(once, { messageId: "1", emoji: "🔥", userId: "u2", action: "added" });
    expect(twice[0]?.reactions).toHaveLength(1);
  });

  it("removes only that user's reaction of that emoji", () => {
    const held = [message("1", { reactions: [{ emoji: "🔥", userId: "u2" }, { emoji: "🔥", userId: "u3" }] })];
    const next = applyReaction(held, { messageId: "1", emoji: "🔥", userId: "u2", action: "removed" });
    expect(next[0]?.reactions).toEqual([{ emoji: "🔥", userId: "u3" }]);
  });

  it("leaves everything alone when the message isn't held", () => {
    const held = [message("1")];
    expect(applyReaction(held, { messageId: "99", emoji: "🔥", userId: "u2", action: "added" })).toEqual(held);
  });
});

describe("summarizeReactions", () => {
  it("counts per emoji, in the configured order, and marks the caller's own", () => {
    const summary = summarizeReactions(
      [
        { emoji: "😂", userId: "u2" },
        { emoji: "🔥", userId: "u1" },
        { emoji: "🔥", userId: "u2" },
      ],
      "u1",
    );
    expect(summary).toEqual([
      { emoji: "🔥", count: 2, mine: true },
      { emoji: "😂", count: 1, mine: false },
    ]);
  });

  it("omits an emoji nobody used", () => {
    expect(summarizeReactions([], "u1")).toEqual([]);
  });
});
