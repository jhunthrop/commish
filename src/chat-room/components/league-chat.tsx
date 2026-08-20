"use client";

import { Button, Card, ErrorState, EYEBROW, Skeleton } from "@/components/ui";
import { useLeagueChat } from "../hooks/use-league-chat";
import { ChatComposer } from "./chat-composer";
import { MessageList } from "./message-list";

/**
 * The one chat surface, mounted unchanged by the league home PAGE and by the draft ROOM's
 * aside band. It owns nothing but its own three states — the hook has the data, the list and
 * the composer have the markup — which is what lets the same element sit in a document and in
 * a fixed-height room band without either layout leaking into it.
 */
export function LeagueChat({ leagueId }: { readonly leagueId: string }) {
  const chat = useLeagueChat(leagueId);

  if (chat.status === "loading") {
    return (
      <Card as="section" aria-label="League chat">
        <Skeleton lines={4} />
      </Card>
    );
  }

  if (chat.status === "error") {
    return (
      <ErrorState
        title="We couldn't open the chat"
        description={chat.error ?? "Something went wrong on our side."}
        action={<Button onClick={() => void chat.refresh()}>Try again</Button>}
      />
    );
  }

  return (
    <Card as="section" aria-label="League chat" className="flex h-full min-h-0 flex-col gap-2">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className={`${EYEBROW} text-text-muted`}>League chat</h2>
        {chat.connection === "reconnecting" ? (
          <p role="status" className="text-xs text-warning">
            Reconnecting…
          </p>
        ) : null}
      </header>
      <MessageList
        leagueId={leagueId}
        messages={chat.messages}
        meUserId={chat.meUserId}
        hasMore={chat.hasMore}
        loadingEarlier={chat.loadingEarlier}
        onLoadEarlier={() => void chat.loadEarlier()}
        onReact={(messageId, emoji) => void chat.react(messageId, emoji)}
      />
      <ChatComposer
        sending={chat.sending}
        onSend={chat.send}
        gifSearchEnabled={chat.gifSearchEnabled}
        onSearchGifs={chat.searchGifs}
      />
    </Card>
  );
}
