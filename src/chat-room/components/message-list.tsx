"use client";

import { useState } from "react";
import type { ChatMessageView } from "@/chat/contract";
import { Avatar, Button } from "@/components/ui";
import { formatChatTime } from "../lib/format";
import { ReactionBar } from "./reaction-bar";
import { RemovedMessage } from "./removed-message";
import { ReportDialog } from "./report-dialog";

export interface MessageListProps {
  readonly leagueId: string;
  readonly messages: readonly ChatMessageView[];
  readonly meUserId: string;
  readonly hasMore: boolean;
  readonly loadingEarlier: boolean;
  readonly onLoadEarlier: () => void;
  readonly onReact: (messageId: string, emoji: string) => void;
}

/**
 * The conversation. `role="log"` + `aria-live="polite"` is what announces an arriving message
 * to a screen reader without moving focus away from the composer somebody is typing in.
 *
 * "Load earlier messages" is an explicit button rather than an infinite scroll: history is
 * paginated on the server, and a button is keyboard-operable, announces its own busy state,
 * and never fires because a finger brushed the top of a list.
 */
export function MessageList({ leagueId, messages, meUserId, hasMore, loadingEarlier, onLoadEarlier, onReact }: MessageListProps) {
  // ONE dialog for the whole list, not one per row: `reportingId` names which message it is
  // open for, so at most one is ever mounted. `null` means closed.
  const [reportingId, setReportingId] = useState<string | null>(null);

  if (messages.length === 0) {
    // ONE QUIET LINE, not a showcase (founder, 2026-08-30, the scan pass): the dashed EmptyState
    // panel made an empty chat the second-loudest element on the league page — a bordered
    // exhibit of nothing, pulling the eye from the matchup it sits beside. Silence should
    // recede; the composer below is its own invitation.
    return (
      <p className="px-1 py-2 text-sm text-text-faint">
        Nobody has said anything yet. Say hello, or ask who is actually starting that kicker.
      </p>
    );
  }

  return (
    <div className="flex max-h-72 min-h-0 flex-col gap-2 overflow-y-auto">
      {hasMore ? (
        <Button variant="secondary" size="sm" loading={loadingEarlier} disabled={loadingEarlier} onClick={onLoadEarlier}>
          Load earlier messages
        </Button>
      ) : null}
      <div role="log" aria-live="polite" aria-label="Messages">
        <ul className="flex flex-col gap-3">
          {messages.map((message) =>
            message.removal !== null ? (
              <li key={message.id}>
                <RemovedMessage authorName={message.authorName} authorAvatarUrl={message.authorAvatarUrl} removal={message.removal} />
              </li>
            ) : (
              // `group/msg` is the intent surface the quiet controls key off — see
              // `ReactionBar`'s own docblock for the whole reveal contract (review E10).
              <li key={message.id} className="group/msg flex gap-2">
                <Avatar name={message.authorName} avatar={message.authorAvatarUrl} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="flex flex-wrap items-baseline gap-2">
                    <span
                      className={`font-display font-semibold ${message.authorUserId === meUserId ? "text-accent" : "text-text-primary"}`}
                    >
                      {message.authorName}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-text-muted">{formatChatTime(message.createdAt)}</span>
                    {message.authorUserId === meUserId ? null : (
                      // Findable when needed, invisible the rest of the time — small, muted,
                      // ALWAYS in the DOM. On hover-capable devices it now also waits for the
                      // row's own intent (review E10) — the media gate keeps a touch screen,
                      // which has no hover, always-on: this product is mobile-first at 360px.
                      <button
                        type="button"
                        onClick={() => setReportingId(message.id)}
                        className="text-xs text-text-muted underline hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [@media(hover:hover)]:opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 focus-visible:opacity-100 transition-opacity motion-reduce:transition-none"
                      >
                        Report
                      </button>
                    )}
                  </p>
                  {message.gif === null ? (
                    <p className="break-words text-text-primary">{message.body}</p>
                  ) : (
                    // The body carries the GIF's alt text as a plain-text fallback (see
                    // `chat-service/chat.ts`'s postMessage), but a sighted reader with the image
                    // showing does not need to read it twice — the <img>'s own `alt` is what a
                    // screen reader announces, both here and if the image never loads.
                    //
                    // A remote Giphy CDN url: next/image would need every third-party rendition
                    // host allowlisted for a domain this app doesn't control, and width/height are
                    // already fixed server-side, so there is no layout-shift benefit it adds here.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={message.gif.url}
                      alt={message.gif.alt}
                      width={message.gif.width}
                      height={message.gif.height}
                      loading="lazy"
                      className="h-auto max-h-64 w-auto max-w-full rounded-md"
                    />
                  )}
                  <ReactionBar
                    targetId={message.id}
                    reactions={message.reactions}
                    meUserId={meUserId}
                    disabled={false}
                    onReact={onReact}
                  />
                </div>
              </li>
            ),
          )}
        </ul>
      </div>
      <ReportDialog open={reportingId !== null} leagueId={leagueId} messageId={reportingId ?? ""} onClose={() => setReportingId(null)} />
    </div>
  );
}
