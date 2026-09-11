"use client";

import { CHAT_CONFIG } from "@/chat/config";
import type { ChatReactionView } from "@/chat/contract";
import { summarizeReactions } from "@/chat/messages";
import { ReactionPill } from "@/components/ui";

export interface ReactionBarProps {
  readonly messageId: string;
  readonly reactions: readonly ChatReactionView[];
  readonly meUserId: string;
  readonly disabled: boolean;
  readonly onReact: (messageId: string, emoji: string) => void;
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

export function ReactionBar({ messageId, reactions, meUserId, disabled, onReact }: ReactionBarProps) {
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
            onToggle={() => onReact(messageId, emoji)}
          />
        );
      })}
    </div>
  );
}
