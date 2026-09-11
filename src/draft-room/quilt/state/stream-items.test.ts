import { describe, expect, it } from "vitest";
import { chatMessage } from "@/chat-room/test-fixtures";
import type { CompletedPick } from "@/draft-engine";
import { mergeStreamItems, unreadSince } from "./stream-items";

const pick = (pickNumber: number, timestamp: string): CompletedPick => ({ pickNumber, round: 1, teamId: "t1", playerId: `p${pickNumber}`, slot: "QB", slotIndex: 0, price: null, timestamp, auto: false });

describe("the draft room's one stream", () => {
  it("merges picks and messages oldest first, a pick before a message at the same instant", () => {
    const items = mergeStreamItems(
      [pick(2, "2026-09-01T00:00:10.000Z"), pick(1, "2026-09-01T00:00:00.000Z")],
      [chatMessage("m1", { createdAt: "2026-09-01T00:00:05.000Z" }), chatMessage("m2", { createdAt: "2026-09-01T00:00:10.000Z" })],
    );
    expect(items.map((item) => item.id)).toEqual(["pick:1", "message:m1", "pick:2", "message:m2"]);
  });

  it("counts what arrived since the stream was last open and names who said your name", () => {
    const items = mergeStreamItems([pick(1, "2026-09-01T00:00:00.000Z")], [
      chatMessage("m1", { createdAt: "2026-09-01T00:00:05.000Z", authorUserId: "u-rey", authorName: "Rey Okafor", body: "Dana, leave him" }),
      chatMessage("m2", { createdAt: "2026-09-01T00:00:06.000Z", authorUserId: "u-cp", authorName: "Coach Parker", body: "backs are going" }),
    ]);
    expect(unreadSince(items, 1, "u-me", "Dana Whitfield")).toEqual({ count: 2, mentionBy: "Rey" });
    expect(unreadSince(items, 3, "u-me", "Dana Whitfield")).toEqual({ count: 0, mentionBy: null });
    expect(unreadSince(items, 0, "u-me", "Coach Parker")).toEqual({ count: 3, mentionBy: null });
  });
});
