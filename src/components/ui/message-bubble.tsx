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
  /**
   * THE BUBBLE IS CARRYING A CARD, NOT A SENTENCE (the wire, 2026-09-11). A message caps at 78%
   * of the stream's width so a one-line reply reads as a one-line reply; a trade offer inside a
   * bubble is a two-column object with faces in it, and the cap squeezes it to 280px on a phone.
   * `wide` drops the cap for that case and nothing else — the bubble, the face beside it and the
   * reaction row are otherwise identical, because the offer IS a message in this room.
   */
  readonly wide?: boolean;
  readonly className?: string;
}

/**
 * THE STREAM'S MESSAGE BUBBLE (P5: the room is a place). Paper with 16px corners and the soft
 * shadow for everyone else; Court blue for you, on the right, because your messages are the one
 * thing on the screen that is yours to press again. The face rides beside it at 28px. The row is
 * a `group/msg` so quiet controls can reveal on its hover or focus.
 */
export function MessageBubble({ author, avatar, mine = false, time, children, reactions, aside, wide = false, className = "" }: MessageBubbleProps) {
  return (
    <div data-testid="message-bubble" data-mine={mine ? "true" : undefined} className={`group/msg flex items-start gap-2.5 ${mine ? "flex-row-reverse" : ""} ${className}`.replace(/\s+/g, " ").trimEnd()}>
      <Avatar name={author} avatar={avatar} size="sm" />
      <div data-wide={wide ? "true" : undefined} className={`flex min-w-0 flex-col gap-1 ${wide ? "flex-1" : "max-w-[78%]"} ${mine ? "items-end" : "items-start"}`}>
        <div className={`min-w-0 rounded-lg px-3 py-2 shadow-card ${wide ? "w-full" : ""} ${mine ? "bg-accent text-accent-text" : "bg-surface-elevated text-text-primary"}`.replace(/\s+/g, " ")}>
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
