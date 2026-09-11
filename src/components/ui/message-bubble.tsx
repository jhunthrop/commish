import type { ReactNode } from "react";
import { Avatar } from "./avatar";

export interface MessageBubbleProps {
  /** Who said it. Printed inside the bubble, above the words, unless it is you. */
  readonly author: string;
  readonly avatar?: string | null;
  /** Your own message: Court blue, on the right, no author line. */
  readonly mine?: boolean;
  /** The clock, already formatted. */
  readonly time?: string;
  /** The words, or a GIF. */
  readonly children: ReactNode;
  /** The reaction pills under the bubble. */
  readonly reactions?: ReactNode;
  /** A quiet control that reveals on the row's intent (report, for instance). */
  readonly aside?: ReactNode;
  readonly className?: string;
}

/**
 * THE STREAM'S MESSAGE BUBBLE (P5: the room is a place). Paper with 16px corners and the soft
 * shadow for everyone else; Court blue for you, on the right, because your messages are the one
 * thing on the screen that is yours to press again. The face rides beside it at 28px. The row is
 * a `group/msg` so quiet controls can reveal on its hover or focus.
 */
export function MessageBubble({ author, avatar, mine = false, time, children, reactions, aside, className = "" }: MessageBubbleProps) {
  return (
    <div data-testid="message-bubble" data-mine={mine ? "true" : undefined} className={`group/msg flex items-start gap-2.5 ${mine ? "flex-row-reverse" : ""} ${className}`.replace(/\s+/g, " ").trimEnd()}>
      <Avatar name={author} avatar={avatar} size="sm" />
      <div className={`flex min-w-0 max-w-[78%] flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
        <div className={`rounded-lg px-3 py-2 shadow-card ${mine ? "bg-accent text-accent-text" : "bg-surface-elevated text-text-primary"}`}>
          {mine ? null : (
            <p className="mb-0.5 flex items-baseline gap-2 text-xs font-semibold text-text-muted">
              <span>{author}</span>
              {time === undefined ? null : <span className="font-normal tabular-nums text-text-faint">{time}</span>}
              {aside}
            </p>
          )}
          <div className="break-words text-md">{children}</div>
        </div>
        {mine && time !== undefined ? <span className="px-1 text-xs tabular-nums text-text-faint">{time}</span> : null}
        {reactions === undefined || reactions === null ? null : <div className="flex flex-wrap items-center gap-1 px-1">{reactions}</div>}
      </div>
    </div>
  );
}
