"use client";

import type { ChatMessageView } from "@/chat/contract";
import { Avatar, Button, EmptyState } from "@/components/ui";
import { formatChatTime } from "../lib/format";
import { ReactionBar } from "./reaction-bar";

export interface MessageListProps {
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
export function MessageList({ messages, meUserId, hasMore, loadingEarlier, onLoadEarlier, onReact }: MessageListProps) {
  if (messages.length === 0) {
    return (
      <EmptyState
        title="Nobody's said anything yet"
        description="Say hello, talk trash, or ask who's actually starting that kicker."
        action={
          <a href="#chat-message-input" className="text-sm font-medium text-accent underline">
            Say hello
          </a>
        }
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {hasMore ? (
        <Button variant="secondary" size="sm" loading={loadingEarlier} disabled={loadingEarlier} onClick={onLoadEarlier}>
          Load earlier messages
        </Button>
      ) : null}
      <div role="log" aria-live="polite" aria-label="Messages">
        <ul className="flex flex-col gap-3">
          {messages.map((message) => (
            <li key={message.id} className="flex gap-2">
              <Avatar name={message.authorName} avatar={message.authorAvatarUrl} />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <p className="flex flex-wrap items-baseline gap-2">
                  <span
                    className={`font-display font-semibold ${message.authorUserId === meUserId ? "text-accent" : "text-text-primary"}`}
                  >
                    {message.authorName}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-text-muted">{formatChatTime(message.createdAt)}</span>
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
                  messageId={message.id}
                  reactions={message.reactions}
                  meUserId={meUserId}
                  disabled={false}
                  onReact={onReact}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
