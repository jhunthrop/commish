"use client";

import { CHAT_CONFIG } from "@/chat/config";
import { summarizeReactions } from "@/chat/messages";
import { ReactionPill } from "@/components/ui";

/**
 * ONE PERSON'S ONE REACTION, as this row needs it — not `ChatReactionView` and not
 * `EventReactionView`, which are the two domain shapes that happen to satisfy it.
 *
 * Declared here because this component serves both (M6): typing the prop as chat's own shape made
 * the stream's events compile only by structural accident, so a field added to `ChatReactionView`
 * would silently become a requirement on every pick, claim and trade too. This is the contract the
 * row actually has — the pair, which is all `summarizeReactions` ever reads.
 */
export interface ReactionEntry {
  readonly emoji: string;
  readonly userId: string;
}

export interface ReactionBarProps {
  /**
   * What is being reacted to — a `chat_messages.id` for a message, an `audit_events.event_id`
   * for a pick, a claim or a trade in the room's stream. Named for the ROLE rather than the
   * table (it was `messageId` until the stream grew reactions of its own) because the set, the
   * pill, the reveal rule and the counting are one thing in this product, and a second copy of
   * this row for events would be a second thing to keep in step.
   */
  readonly targetId: string;
  readonly reactions: readonly ReactionEntry[];
  readonly meUserId: string;
  readonly disabled: boolean;
  readonly onReact: (targetId: string, emoji: string) => void;
}

/**
 * The whole reaction set, in the DOM for every message: five pills is cheaper to hit on a phone
 * than a picker behind a menu, and it keeps the row's width constant as counts land.
 *
 * Quiet until wanted: a ZERO-count pill is an offer, not information, so on a hover-capable
 * device it reveals only on the message row's own hover or focus intent (the parent renders
 * `group/msg`, which `MessageBubble` owns). The gate is `@media(hover:hover)`: a touch screen has
 * no hover, so there the offers stay always visible. Opacity only, never display, so focus lands
 * on the real button and reveals it. A pill with a landed count IS information and never hides.
 */
const REVEAL_ON_INTENT = "[@media(hover:hover)]:opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 focus-visible:opacity-100 transition-opacity motion-reduce:transition-none";

export function ReactionBar({ targetId, reactions, meUserId, disabled, onReact }: ReactionBarProps) {
  const summary = summarizeReactions(reactions, meUserId);
  const countFor = (emoji: string): number => summary.find((entry) => entry.emoji === emoji)?.count ?? 0;
  const mineFor = (emoji: string): boolean => summary.find((entry) => entry.emoji === emoji)?.mine ?? false;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {CHAT_CONFIG.reactions.map((emoji) => {
        const count = countFor(emoji);
        return (
          <ReactionPill
            key={emoji}
            emoji={emoji}
            count={count}
            mine={mineFor(emoji)}
            disabled={disabled}
            className={count === 0 ? REVEAL_ON_INTENT : undefined}
            onToggle={() => onReact(targetId, emoji)}
          />
        );
      })}
    </div>
  );
}
