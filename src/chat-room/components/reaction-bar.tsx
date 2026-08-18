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
 * The whole reaction set, always visible — five buttons is cheaper to hit on a phone than a
 * picker behind a menu, and it keeps the row's width constant as counts land.
 *
 * `aria-pressed` is what makes a toggle a toggle to a screen reader; the count is plain text
 * inside the same button so the accessible name stays stable ("React with 🔥") while the
 * number changes.
 */
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
