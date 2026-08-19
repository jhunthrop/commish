import type { ChatMessageView, ChatReactionPayload, ChatReactionView } from "./contract";

export type ChatFrame =
  | { readonly kind: "message"; readonly message: ChatMessageView }
  | { readonly kind: "reaction"; readonly reaction: ChatReactionPayload };

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toReactions(value: unknown): readonly ChatReactionView[] {
  if (!Array.isArray(value)) return [];
  // A malformed entry is dropped, never fatal: one bad reaction must not cost the message.
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    const emoji = asString(record?.emoji);
    const userId = asString(record?.userId);
    return emoji === null || userId === null ? [] : [{ emoji, userId }];
  });
}

function toMessage(value: unknown): ChatMessageView | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id);
  const authorUserId = asString(record.authorUserId);
  const authorName = asString(record.authorName);
  const body = asString(record.body);
  const createdAt = asString(record.createdAt);
  if (id === null || authorUserId === null || authorName === null || body === null || createdAt === null) return null;
  return {
    id,
    authorUserId,
    authorName,
    authorAvatarUrl: asString(record.authorAvatarUrl),
    body,
    createdAt,
    reactions: toReactions(record.reactions),
  };
}

function toReaction(value: unknown): ChatReactionPayload | null {
  const record = asRecord(value);
  if (record === null) return null;
  const messageId = asString(record.messageId);
  const emoji = asString(record.emoji);
  const userId = asString(record.userId);
  const action = asString(record.action);
  if (messageId === null || emoji === null || userId === null) return null;
  if (action !== "added" && action !== "removed") return null;
  return { messageId, emoji, userId, action };
}

/**
 * The one place a raw SSE `data:` string becomes chat state. Server-produced, but parsed
 * defensively anyway: a frame is untrusted text by the time it reaches the browser, and a
 * throw inside an `EventSource` listener would take the whole panel down.
 */
export function parseChatFrame(raw: string): ChatFrame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const frame = asRecord(parsed);
  if (frame === null) return null;

  if (frame.type === "chat.message") {
    const message = toMessage(asRecord(frame.payload)?.message);
    return message === null ? null : { kind: "message", message };
  }
  if (frame.type === "chat.reaction") {
    const reaction = toReaction(frame.payload);
    return reaction === null ? null : { kind: "reaction", reaction };
  }
  return null;
}
