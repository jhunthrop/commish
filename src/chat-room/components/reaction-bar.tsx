"use client";

import { CHAT_CONFIG } from "@/chat/config";
import type { ChatReactionView } from "@/chat/contract";
import { summarizeReactions } from "@/chat/messages";
import { Button } from "@/components/ui";

export interface ReactionBarProps {
  readonly messageId: string;
  readonly reactions: readonly ChatReactionView[];
  readonly meUserId: string;
  readonly disabled: boolean;
  readonly onReact: (messageId: string, emoji: string) => void;
}

/**
 * The whole reaction set, in the DOM for every message — five buttons is cheaper to hit on a
 * phone than a picker behind a menu, and it keeps the row's width constant as counts land.
 *
 * Quiet until wanted (review E10): a ZERO-count button is an offer, not information, so on a
 * hover-capable device it reveals only on the message row's own hover or focus intent (the
 * parent `<li>` renders `group/msg` — `MessageList` owns that contract). The gate is
 * `@media(hover:hover)`: a touch screen has no hover, so there the offers stay always visible,
 * exactly the mobile-first rule the Report link has always kept. A button with a landed count
 * IS information and never hides. Opacity only, never display — focus lands on the real
 * button and reveals it, so keyboard and AT lose nothing.
 *
 * `aria-pressed` is what makes a toggle a toggle to a screen reader; the count is plain text
 * inside the same button so the accessible name stays stable ("React with 🔥") while the
 * number changes.
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
          <Button
            key={emoji}
            size="sm"
            variant="ghost"
            className={count === 0 ? REVEAL_ON_INTENT : undefined}
            disabled={disabled}
            aria-pressed={mineFor(emoji)}
            aria-label={`React with ${emoji}`}
            onClick={() => onReact(messageId, emoji)}
          >
            <span aria-hidden="true">{emoji}</span>
            {count === 0 ? null : <span className="ml-1 font-mono text-xs tabular-nums text-text-muted">{count}</span>}
          </Button>
        );
      })}
    </div>
  );
}
