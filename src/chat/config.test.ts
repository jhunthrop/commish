import { describe, it, expect } from "vitest";
import { CHAT_CONFIG, isReactionEmoji } from "./config";

describe("CHAT_CONFIG", () => {
  it("offers a small, closed reaction set with no duplicates", () => {
    expect(CHAT_CONFIG.reactions.length).toBeGreaterThan(0);
    expect(new Set(CHAT_CONFIG.reactions).size).toBe(CHAT_CONFIG.reactions.length);
  });

  it("keeps a page smaller than what a client holds, so paging can never overflow the buffer", () => {
    expect(CHAT_CONFIG.pageSize).toBeLessThan(CHAT_CONFIG.maxHeldMessages);
  });
});

describe("isReactionEmoji", () => {
  it("accepts every configured reaction", () => {
    for (const emoji of CHAT_CONFIG.reactions) expect(isReactionEmoji(emoji)).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isReactionEmoji("💀")).toBe(false);
  });
});
