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
 * Folds messages together by id, in chronological order, WITHOUT the held-buffer cap.
 *
 * Reactions are UNIONED rather than overwritten: a `Last-Event-ID` replay redelivers a
 * `chat.message` frame whose payload was built before anybody reacted, and taking that frame's
 * empty list literally would silently erase reactions already folded from later frames.
 * Everything here is set-shaped, so replay is a no-op instead of a correction.
 *
 * Separate from `mergeMessages` because the cap is only correct for GROWTH the client did not
 * ask for. A refetch of the newest page is bounded by the server's own page size, so unioning
 * it into the buffer cannot grow that buffer without bound — while capping it would re-apply
 * "keep the newest 500" to a buffer that backward pagination deliberately grew past 500, and
 * throw away exactly the history a user asked for.
 */
export function unionMessages(
  held: readonly ChatMessageView[],
  incoming: readonly ChatMessageView[],
): readonly ChatMessageView[] {
  const byId = new Map<string, ChatMessageView>();
  for (const message of [...held, ...incoming]) {
    const existing = byId.get(message.id);
    byId.set(message.id, {
      ...message,
      reactions: dedupeReactions(existing === undefined ? message.reactions : [...existing.reactions, ...message.reactions]),
      // STICKY, not last-write-wins: removal is a stamp that only ever moves one direction
      // (null -> set, never back — the no-re-stamp guard lives in `removeChatMessageInTx`'s own
      // `UPDATE ... WHERE`), so once ANY frame folded here has seen the removal, it must survive
      // every later fold no matter what order frames arrive in. The composer's optimistic echo
      // and the SSE fold both write into this same held list, and an older copy of the message
      // (posted before the removal, redelivered after it) carries `removal: null` — taking it at
      // face value would silently un-remove a message on screen. `existing?.removal` wins over
      // `message.removal` whenever it is non-null; the two can never disagree once both are
      // non-null, because a message has exactly one removal.
      removal: existing?.removal ?? message.removal,
    });
  }
  // Ids are a bigserial, so a numeric compare IS chronological order — no timestamp tie to break.
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id));
}

/**
 * `unionMessages` plus the held-buffer cap: what a LIVE frame goes through, where growth is
 * unbounded (a busy league can publish all day) and the newest messages are the ones worth
 * keeping.
 */
export function mergeMessages(
  held: readonly ChatMessageView[],
  incoming: readonly ChatMessageView[],
): readonly ChatMessageView[] {
  const ordered = unionMessages(held, incoming);
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
