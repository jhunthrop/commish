import type { ActivityKind } from "@/integrity/activity-view";
import type { EventReactionPayload, EventReactionView } from "../contract";

/** Every reaction the room currently holds, keyed by audit event id. */
export type EventReactionMap = ReadonlyMap<string, readonly EventReactionView[]>;

/**
 * THE THINGS A REACTION ATTACHES TO (Sideline P5: "picks, trades, claims, wins and messages are
 * one stream ... and reactions attach to all of them"). A pick, a claim and a trade are things a
 * PERSON did and the room has an opinion about. A join, a lineup change, a money movement and
 * everything the platform did on its own are not: nobody wants a laughing face on "the entry fee
 * was collected", and an offer to react to it would be five dead controls on every such row.
 */
const REACTABLE: ReadonlySet<ActivityKind> = new Set<ActivityKind>(["pick", "claim", "trade"]);

export function isReactableKind(kind: ActivityKind): boolean {
  return REACTABLE.has(kind);
}

/**
 * Folds one `stream.reaction` frame in. Remove-then-maybe-add, exactly as `applyReaction` folds
 * a `chat.reaction`, so a redelivered "added" produces one entry and a "removed" for something
 * already gone is a no-op — which is what makes a `Last-Event-ID` replay free.
 *
 * An event the room is not currently holding is folded anyway rather than dropped: the map is
 * keyed by event id and carries no dependency on the page of events beside it, so the entry is
 * simply there if that event ever scrolls in. The empty case collapses back to no key at all,
 * so an event nobody reacts to leaves no trace.
 */
export function applyEventReaction(held: EventReactionMap, payload: EventReactionPayload): EventReactionMap {
  const next = new Map(held);
  const without = (next.get(payload.eventId) ?? []).filter(
    (reaction) => !(reaction.emoji === payload.emoji && reaction.userId === payload.userId),
  );
  const after: readonly EventReactionView[] =
    payload.action === "removed" ? without : [...without, { emoji: payload.emoji, userId: payload.userId }];
  if (after.length === 0) next.delete(payload.eventId);
  else next.set(payload.eventId, after);
  return next;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * The one place a raw SSE `data:` string becomes a stream reaction. Server-produced, but parsed
 * defensively anyway for the reason `parseChatFrame` states: a frame is untrusted text by the
 * time it reaches the browser, and a throw inside an `EventSource` listener would take the whole
 * room down.
 */
export function parseStreamReactionFrame(raw: string): EventReactionPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const frame = asRecord(parsed);
  if (frame === null || frame.type !== "stream.reaction") return null;
  const payload = asRecord(frame.payload);
  if (payload === null) return null;
  const eventId = asString(payload.eventId);
  const emoji = asString(payload.emoji);
  const userId = asString(payload.userId);
  const action = asString(payload.action);
  if (eventId === null || emoji === null || userId === null) return null;
  if (action !== "added" && action !== "removed") return null;
  return { eventId, emoji, userId, action };
}
