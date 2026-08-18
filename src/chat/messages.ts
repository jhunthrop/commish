import { CHAT_CONFIG } from "./config";
import type { ChatMessageView, ChatReactionPayload, ChatReactionView } from "./contract";

export interface ReactionSummary {
  readonly emoji: string;
  readonly count: number;
  readonly mine: boolean;
}

function dedupeReactions(reactions: readonly ChatReactionView[]): readonly ChatReactionView[] {
  const seen = new Set<string>();
  const out: ChatReactionView[] = [];
  for (const reaction of reactions) {
    const key = `${reaction.emoji}:${reaction.userId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(reaction);
  }
  return out;
}

/**
 * Folds a page or a live frame into the list a client holds.
 *
 * Reactions are UNIONED rather than overwritten: a `Last-Event-ID` replay redelivers a
 * `chat.message` frame whose payload was built before anybody reacted, and taking that frame's
 * empty list literally would silently erase reactions already folded from later frames.
 * Everything here is set-shaped, so replay is a no-op instead of a correction.
 */
export function mergeMessages(
  held: readonly ChatMessageView[],
  incoming: readonly ChatMessageView[],
): readonly ChatMessageView[] {
  const byId = new Map<string, ChatMessageView>();
  for (const message of [...held, ...incoming]) {
    const existing = byId.get(message.id);
    byId.set(message.id, {
      ...message,
      reactions: dedupeReactions(existing === undefined ? message.reactions : [...existing.reactions, ...message.reactions]),
    });
  }
  // Ids are a bigserial, so a numeric compare IS chronological order — no timestamp tie to break.
  const ordered = [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
  return ordered.length <= CHAT_CONFIG.maxHeldMessages ? ordered : ordered.slice(ordered.length - CHAT_CONFIG.maxHeldMessages);
}

/**
 * Folds one `chat.reaction` frame in. Remove-then-maybe-add, so a redelivered "added" produces
 * exactly one entry and a "removed" for something already gone is a no-op.
 */
export function applyReaction(
  held: readonly ChatMessageView[],
  payload: ChatReactionPayload,
): readonly ChatMessageView[] {
  return held.map((message) => {
    if (message.id !== payload.messageId) return message;
    const without = message.reactions.filter(
      (reaction) => !(reaction.emoji === payload.emoji && reaction.userId === payload.userId),
    );
    return {
      ...message,
      reactions: payload.action === "removed" ? without : [...without, { emoji: payload.emoji, userId: payload.userId }],
    };
  });
}

/**
 * Counts for rendering, in the configured emoji order so the chips never reorder under a
 * reaction landing. An emoji nobody used gets no chip at all.
 */
export function summarizeReactions(
  reactions: readonly ChatReactionView[],
  meUserId: string,
): readonly ReactionSummary[] {
  return CHAT_CONFIG.reactions.flatMap((emoji) => {
    const forEmoji = reactions.filter((reaction) => reaction.emoji === emoji);
    if (forEmoji.length === 0) return [];
    return [{ emoji, count: forEmoji.length, mine: forEmoji.some((reaction) => reaction.userId === meUserId) }];
  });
}
