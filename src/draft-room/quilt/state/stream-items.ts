import type { ChatMessageView } from "@/chat/contract";
import type { CompletedPick } from "@/draft-engine";
import { mentionsMe } from "./mentions";

/**
 * THE ONE STREAM (P5, ruling 1: "the picks are the stream"): every pick and every message in
 * one column, oldest first, newest at the foot beside the field. Pure over the room's own facts
 * so the merge, the unread count and the mention flag are testable without a DOM.
 */
export type StreamItem = { readonly kind: "pick"; readonly id: string; readonly at: string; readonly pick: CompletedPick } | { readonly kind: "message"; readonly id: string; readonly at: string; readonly message: ChatMessageView };

export function mergeStreamItems(picks: readonly CompletedPick[], messages: readonly ChatMessageView[]): readonly StreamItem[] {
  const items: StreamItem[] = [
    ...picks.map((pick): StreamItem => ({ kind: "pick", id: `pick:${pick.pickNumber}`, at: pick.timestamp, pick })),
    ...messages.map((message): StreamItem => ({ kind: "message", id: `message:${message.id}`, at: message.createdAt, message })),
  ];
  // A stable sort by time; two events at the same instant keep pick-before-message order.
  return items.map((item, index) => ({ item, index })).sort((a, b) => a.item.at.localeCompare(b.item.at) || a.index - b.index).map(({ item }) => item);
}

export interface Unread {
  readonly count: number;
  /** The first name of the latest unread person who said your name, or null. */
  readonly mentionBy: string | null;
}

/** What arrived after the reader last had the stream open: `seen` is the item count then. */
export function unreadSince(items: readonly StreamItem[], seen: number, meUserId: string, myName: string | null): Unread {
  const fresh = items.slice(Math.min(seen, items.length));
  let mentionBy: string | null = null;
  for (const item of fresh) {
    if (item.kind === "message" && mentionsMe(item.message, meUserId, myName)) mentionBy = item.message.authorName.trim().split(/\s+/)[0] ?? item.message.authorName;
  }
  return { count: fresh.length, mentionBy };
}
