import { describe, it, expect } from "vitest";
import type { ChatMessageView } from "@/chat/contract";
import type { ActivityFeedRow } from "@/integrity-service/activity";
import { mergeStream } from "./stream-items";

function row(eventId: string, occurredAt: string): ActivityFeedRow {
  return { eventId, occurredAt, icon: "users", headline: `${eventId} happened`, detail: null, kind: "pick", actor: null };
}

function message(id: string, createdAt: string): ChatMessageView {
  return { id, authorUserId: "u2", authorName: "Rey Okafor", authorAvatarUrl: null, body: "hi", createdAt, reactions: [], gif: null, removal: null };
}

describe("mergeStream", () => {
  it("interleaves events and messages oldest first, newest at the foot", () => {
    const items = mergeStream(
      [row("e2", "2026-09-10T12:02:00.000Z"), row("e1", "2026-09-10T12:00:00.000Z")],
      [message("m1", "2026-09-10T12:01:00.000Z"), message("m2", "2026-09-10T12:03:00.000Z")],
    );
    expect(items.map((item) => item.id)).toEqual(["event:e1", "message:m1", "event:e2", "message:m2"]);
  });

  it("puts the event before the message about it when they share an instant", () => {
    const at = "2026-09-10T12:00:00.000Z";
    const items = mergeStream([row("e1", at)], [message("m1", at)]);
    expect(items.map((item) => item.kind)).toEqual(["event", "message"]);
  });

  it("answers empty for an empty room and never mutates its inputs", () => {
    const events = [row("e1", "2026-09-10T12:00:00.000Z")];
    expect(mergeStream([], [])).toEqual([]);
    mergeStream(events, []);
    expect(events[0]!.eventId).toBe("e1");
  });
});
