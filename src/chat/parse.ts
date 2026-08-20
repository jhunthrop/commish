import type { ChatGif, ChatMessageRemoval, ChatMessageView, ChatReactionPayload, ChatReactionView } from "./contract";

export type ChatFrame =
  | { readonly kind: "message"; readonly message: ChatMessageView }
  | { readonly kind: "reaction"; readonly reaction: ChatReactionPayload };

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A malformed or absent `gif` field is treated as no GIF, never a fatal parse — the message's text still stands on its own. */
function toGif(value: unknown): ChatGif | null {
  const record = asRecord(value);
  if (record === null) return null;
  const url = asString(record.url);
  const previewUrl = asString(record.previewUrl);
  const alt = asString(record.alt);
  const width = asFiniteNumber(record.width);
  const height = asFiniteNumber(record.height);
  if (url === null || previewUrl === null || alt === null || width === null || height === null) return null;
  return { url, previewUrl, alt, width, height };
}

/**
 * A malformed or absent `removal` field is treated as "not removed" — the message still renders
 * with its body — never a fatal parse. `at`/`phrase` are both required together: a removal with
 * only one of them present did not come from a real `ChatMessageRemoval` and is not trusted.
 */
function toRemoval(value: unknown): ChatMessageRemoval | null {
  const record = asRecord(value);
  if (record === null) return null;
  const at = asString(record.at);
  const phrase = asString(record.phrase);
  return at === null || phrase === null ? null : { at, phrase };
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
    gif: toGif(record.gif),
    removal: toRemoval(record.removal),
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
