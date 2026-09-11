"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessageView } from "@/chat/contract";
import { ChatComposer } from "@/chat-room/components/chat-composer";
import { ReactionBar } from "@/chat-room/components/reaction-bar";
import { RemovedMessage } from "@/chat-room/components/removed-message";
import { ReportDialog } from "@/chat-room/components/report-dialog";
import { useLeagueChat } from "@/chat-room/hooks/use-league-chat";
import { formatChatTime } from "@/chat-room/lib/format";
import { Avatar, Button, ErrorState, MessageBubble, Skeleton } from "@/components/ui";
import { ChapterBand } from "@/components/ui/chapter-band";
import { Icon } from "@/components/ui/icon";
import type { ActivityFeedRow } from "@/integrity-service/activity";
import { byDay, dayMarker } from "../lib/day-chapters";
import { mergeStream, type StreamItem } from "../lib/stream-items";

export interface RoomStreamProps {
  readonly leagueId: string;
  readonly activityRows: readonly ActivityFeedRow[];
  /** The page has no other solid button, so the composer's Send becomes the page's act. */
  readonly sendIsTheAct: boolean;
}

/** Something somebody did, drawn as a person doing it: their face, the sentence, the clock. */
function StreamEvent({ row }: { readonly row: ActivityFeedRow }) {
  return (
    <div data-testid="stream-event" data-kind={row.kind} className="flex items-start gap-2.5">
      {row.actor === null ? (
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-pill bg-surface text-text-faint">
          <Icon name={row.icon} size={14} />
        </span>
      ) : (
        <Avatar name={row.actor.name} avatar={row.actor.avatar} size="sm" />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="break-words text-md text-text-primary">{row.headline}</p>
        {row.detail === null ? null : <p className="break-words text-sm text-text-muted">{row.detail}</p>}
        <time dateTime={row.occurredAt} className="text-xs tabular-nums text-text-faint">
          {formatChatTime(row.occurredAt)}
        </time>
      </div>
    </div>
  );
}

interface StreamMessageProps {
  readonly leagueId: string;
  readonly message: ChatMessageView;
  readonly meUserId: string;
  readonly onReact: (messageId: string, emoji: string) => void;
  readonly onReport: (messageId: string) => void;
}

function StreamMessage({ leagueId, message, meUserId, onReact, onReport }: StreamMessageProps) {
  void leagueId;
  if (message.removal !== null) {
    return <RemovedMessage authorName={message.authorName} authorAvatarUrl={message.authorAvatarUrl} removal={message.removal} />;
  }
  const mine = message.authorUserId === meUserId;
  return (
    <MessageBubble
      author={message.authorName}
      avatar={message.authorAvatarUrl}
      mine={mine}
      time={formatChatTime(message.createdAt)}
      reactions={<ReactionBar messageId={message.id} reactions={message.reactions} meUserId={meUserId} disabled={false} onReact={onReact} />}
      aside={
        mine ? undefined : (
          <button
            type="button"
            onClick={() => onReport(message.id)}
            className="text-xs text-text-faint underline hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent [@media(hover:hover)]:opacity-0 group-hover/msg:opacity-100 group-focus-within/msg:opacity-100 focus-visible:opacity-100 transition-opacity motion-reduce:transition-none"
          >
            Report
          </button>
        )
      }
    >
      {message.gif === null ? (
        message.body
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a remote Giphy rendition; width and height are fixed server-side
        <img src={message.gif.url} alt={message.gif.alt} width={message.gif.width} height={message.gif.height} loading="lazy" className="h-auto max-h-64 w-auto max-w-full rounded-md" />
      )}
    </MessageBubble>
  );
}

/**
 * THE ONE STREAM (P5, P12): what changed since you were last here, as one column of people doing
 * things and saying things, newest at the foot, with the say-something field one tap away. The
 * league's history (picks, claims, trades, joins) rides in from the server; the messages ride
 * `useLeagueChat`, so a message landing or a reaction popping is the same live wire the chat has
 * always had. A room with nothing in it yet says so once and hands you the field.
 */
export function RoomStream({ leagueId, activityRows, sendIsTheAct }: RoomStreamProps) {
  const chat = useLeagueChat(leagueId);
  const [reportingId, setReportingId] = useState<string | null>(null);
  const footRef = useRef<HTMLDivElement | null>(null);
  const items = mergeStream(activityRows, chat.messages);
  const itemCount = items.length;

  useEffect(() => {
    footRef.current?.scrollIntoView({ block: "end" });
  }, [itemCount]);

  if (chat.status === "loading") {
    return (
      <section aria-label="The room" className="flex flex-col gap-3">
        <Skeleton lines={4} />
      </section>
    );
  }
  if (chat.status === "error") {
    return <ErrorState title="We could not open the room" description={chat.error ?? undefined} action={<Button variant="secondary" onClick={() => void chat.refresh()}>Try again</Button>} />;
  }

  const now = new Date();
  return (
    <section aria-label="The room" data-testid="room-stream" className="flex min-h-0 flex-1 flex-col gap-3">
      {chat.connection === "reconnecting" ? (
        <p role="status" className="text-xs text-text-faint">
          Reconnecting
        </p>
      ) : null}
      {chat.hasMore ? (
        <Button variant="secondary" size="sm" className="self-center" loading={chat.loadingEarlier} disabled={chat.loadingEarlier} onClick={() => void chat.loadEarlier()}>
          Earlier messages
        </Button>
      ) : null}
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-text-faint">Nothing has happened here yet. Say the first thing.</p>
      ) : (
        <div role="log" aria-live="polite" aria-label="What happened" className="flex flex-col gap-4">
          {byDay(items).map((chapter) => (
            <section key={chapter.key} aria-label={dayMarker(chapter.rows[0]!.occurredAt, now)} className="flex flex-col gap-3">
              <ChapterBand name={dayMarker(chapter.rows[0]!.occurredAt, now)} consequence={`${chapter.rows.length} ${chapter.rows.length === 1 ? "thing" : "things"}`} />
              {chapter.rows.map((item: StreamItem) =>
                item.kind === "event" ? (
                  <StreamEvent key={item.id} row={item.row} />
                ) : (
                  <StreamMessage key={item.id} leagueId={leagueId} message={item.message} meUserId={chat.meUserId} onReact={(id, emoji) => void chat.react(id, emoji)} onReport={setReportingId} />
                ),
              )}
            </section>
          ))}
        </div>
      )}
      <div ref={footRef} />
      <ChatComposer sending={chat.sending} onSend={chat.send} gifSearchEnabled={chat.gifSearchEnabled} onSearchGifs={chat.searchGifs} sendVariant={sendIsTheAct ? "verb" : "secondary"} />
      <ReportDialog open={reportingId !== null} leagueId={leagueId} messageId={reportingId ?? ""} onClose={() => setReportingId(null)} />
    </section>
  );
}
