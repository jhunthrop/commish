import type { ChatMessageView } from "@/chat/contract";
import type { ActivityFeedRow } from "@/integrity-service/activity";

/**
 * THE ONE STREAM (P5): picks, claims, trades and messages in one column, in one voice. An item
 * is either a thing somebody did (an activity row with its actor) or a thing somebody said.
 * Scores are not items yet: a settled matchup carries no settlement instant the product could
 * honestly place in time, so the week's result lives on the rival card instead.
 */
export type StreamItem =
  | { readonly kind: "event"; readonly id: string; readonly occurredAt: string; readonly row: ActivityFeedRow }
  | { readonly kind: "message"; readonly id: string; readonly occurredAt: string; readonly message: ChatMessageView };

/**
 * Oldest first, newest at the foot where the composer is, like any conversation. A tie in time
 * puts the event before the message about it. Pure: a new frame or a new page rebuilds the list.
 */
export function mergeStream(events: readonly ActivityFeedRow[], messages: readonly ChatMessageView[]): readonly StreamItem[] {
  const items: readonly StreamItem[] = [
    ...events.map((row): StreamItem => ({ kind: "event", id: `event:${row.eventId}`, occurredAt: row.occurredAt, row })),
    ...messages.map((message): StreamItem => ({ kind: "message", id: `message:${message.id}`, occurredAt: message.createdAt, message })),
  ];
  return [...items].sort((a, b) => {
    const delta = Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
    if (delta !== 0) return delta;
    if (a.kind !== b.kind) return a.kind === "event" ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });
}
