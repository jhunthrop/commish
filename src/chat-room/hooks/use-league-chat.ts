"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessageView, ChatPageBody, PostChatBody, ReactionBody } from "@/chat/contract";
import { applyReaction, mergeMessages, unionMessages } from "@/chat/messages";
import { parseChatFrame } from "@/chat/parse";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useChatRoomDeps } from "./deps";

const LOAD_ERROR = "We couldn't load the chat. Check your connection and try again.";
const SEND_ERROR = "We couldn't send that. Check your connection and try again.";

/** The two frame types this hook owns. Draft and scoring frames ride the same stream and are ignored. */
const CHAT_EVENT_TYPES = ["chat.message", "chat.reaction"] as const;

export type ChatConnection = "connecting" | "live" | "reconnecting";
export type SendOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

interface LeagueChatState {
  readonly status: "loading" | "ready" | "error";
  readonly error: string | null;
  readonly messages: readonly ChatMessageView[];
  readonly meUserId: string;
  readonly hasMore: boolean;
  readonly loadingEarlier: boolean;
  readonly sending: boolean;
  readonly connection: ChatConnection;
}

export interface LeagueChat extends LeagueChatState {
  readonly send: (body: string) => Promise<SendOutcome>;
  readonly react: (messageId: string, emoji: string) => Promise<SendOutcome>;
  readonly loadEarlier: () => Promise<void>;
  readonly refresh: () => Promise<void>;
}

const INITIAL: LeagueChatState = {
  status: "loading",
  error: null,
  messages: [],
  meUserId: "",
  hasMore: false,
  loadingEarlier: false,
  sending: false,
  connection: "connecting",
};

/**
 * Chat's one data layer: fetch the newest page, subscribe to the league stream, fold frames in,
 * and page backwards on demand.
 *
 * Reconnect is the browser's, exactly as `useDraftRoom` documents: a native `EventSource`
 * retries on its own and replays `Last-Event-ID`. There is no retry loop, backoff timer or poll
 * here — only the page refetch that every `open` fires, which covers the gap between the mount
 * fetch resolving and the stream actually opening.
 *
 * Two carried findings from the Task 1 review of `@/chat/messages`, both resolved here:
 *
 * 1. `mergeMessages`'s cap-and-trim always keeps the NEWEST `CHAT_CONFIG.maxHeldMessages`
 *    entries, which is correct for live-frame growth but defeats backward pagination. Only the
 *    LIVE-frame path goes through it. `loadEarlier` prepends directly (see its own docblock)
 *    and `refresh` unions without trimming — otherwise any reconnect, which fires `refresh`,
 *    would re-cap a buffer pagination had deliberately grown and discard loaded history.
 * 2. An out-of-order `chat.reaction` frame (for a message not currently held) is silently
 *    dropped by `applyReaction`'s no-op branch, with no queue or later re-application. That is
 *    provably safe here: every fetch this hook makes (`refresh`, the mount effect, and
 *    `loadEarlier`) returns each message with its CURRENT reaction set already attached — chat
 *    history is never delta-applied from frames. So the instant a message is loaded at all
 *    (whether it was already held, or arrives later via `loadEarlier`), its reactions are
 *    already correct; a frame dropped before that point was redundant, not a lost update.
 */
export function useLeagueChat(leagueId: string): LeagueChat {
  const deps = useChatRoomDeps();
  const [state, setState] = useState<LeagueChatState>(INITIAL);
  // Long-lived closures (the SSE listeners) need today's messages without re-subscribing.
  const messagesRef = useRef<readonly ChatMessageView[]>([]);

  const write = useCallback((messages: readonly ChatMessageView[]): void => {
    messagesRef.current = messages;
    setState((prev) => ({ ...prev, messages }));
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const response = await deps.fetchJson(`/api/leagues/${leagueId}/chat`);
      const body = (await response.json()) as ApiEnvelope<ChatPageBody>;
      if (!body.ok) {
        setState((prev) => ({ ...prev, status: "error", error: body.error }));
        return;
      }
      // `unionMessages`, NOT `mergeMessages`: the cap keeps the newest `maxHeldMessages`, and
      // every reconnect fires this (see the `open` handler). Capping here would re-trim a
      // buffer that `loadEarlier` deliberately grew past the cap and discard the history the
      // user explicitly paged in — unreachably, since `hasMore` may already be false. This
      // input is one server page, so the union cannot grow the buffer without bound.
      const merged = unionMessages(messagesRef.current, body.data.messages);
      messagesRef.current = merged;
      setState((prev) => ({
        ...prev,
        status: "ready",
        error: null,
        messages: merged,
        meUserId: body.data.meUserId,
        // A later page's `hasMore` never un-says an earlier "there is more behind you".
        hasMore: prev.status === "loading" ? body.data.hasMore : prev.hasMore,
      }));
    } catch {
      setState((prev) => ({ ...prev, status: "error", error: LOAD_ERROR }));
    }
  }, [deps, leagueId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const source = deps.openEventSource(`/api/leagues/${leagueId}/events`);

    const onChatEvent = (event: MessageEvent): void => {
      const frame = parseChatFrame(String(event.data));
      if (frame === null) return;
      write(
        frame.kind === "message"
          ? mergeMessages(messagesRef.current, [frame.message])
          : applyReaction(messagesRef.current, frame.reaction),
      );
    };

    const onOpen = (): void => {
      setState((prev) => ({ ...prev, connection: "live" }));
      // Every open resyncs — the first included. The stream only carries what is published
      // after it opens, so a message posted while the mount fetch was in flight would
      // otherwise sit unseen until the next one arrived.
      void refresh();
    };

    const onError = (): void => {
      setState((prev) => ({ ...prev, connection: "reconnecting" }));
    };

    for (const type of CHAT_EVENT_TYPES) source.addEventListener(type, onChatEvent);
    source.addEventListener("open", onOpen);
    source.addEventListener("error", onError);

    return () => source.close();
  }, [deps, leagueId, refresh, write]);

  const send = useCallback(
    async (body: string): Promise<SendOutcome> => {
      setState((prev) => ({ ...prev, sending: true }));
      try {
        const response = await deps.fetchJson(`/api/leagues/${leagueId}/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body }),
        });
        const envelope = (await response.json()) as ApiEnvelope<PostChatBody>;
        if (!envelope.ok) return { ok: false, reason: envelope.error };
        // The server's own copy is folded in directly, so the message appears even if this
        // browser's stream frame is still in flight; `mergeMessages` makes the echo a no-op.
        write(mergeMessages(messagesRef.current, [envelope.data.message]));
        return { ok: true };
      } catch {
        return { ok: false, reason: SEND_ERROR };
      } finally {
        setState((prev) => ({ ...prev, sending: false }));
      }
    },
    [deps, leagueId, write],
  );

  const react = useCallback(
    async (messageId: string, emoji: string): Promise<SendOutcome> => {
      try {
        const response = await deps.fetchJson(`/api/leagues/${leagueId}/chat/${messageId}/reactions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ emoji }),
        });
        const envelope = (await response.json()) as ApiEnvelope<ReactionBody>;
        if (!envelope.ok) return { ok: false, reason: envelope.error };
        // FOLDED, never replaced: the response says what this toggle did, and `applyReaction`
        // applies it exactly as a `chat.reaction` frame would. Replacing the array with a
        // server-side snapshot would erase a peer's reaction this browser had already folded in
        // from a frame, and nothing would restore it until the next refresh.
        write(
          applyReaction(messagesRef.current, {
            messageId: envelope.data.messageId,
            emoji,
            userId: state.meUserId,
            action: envelope.data.action,
          }),
        );
        return { ok: true };
      } catch {
        return { ok: false, reason: SEND_ERROR };
      }
    },
    [deps, leagueId, state.meUserId, write],
  );

  const loadEarlier = useCallback(async (): Promise<void> => {
    const oldest = messagesRef.current[0];
    if (oldest === undefined) return;
    setState((prev) => ({ ...prev, loadingEarlier: true }));
    try {
      const response = await deps.fetchJson(`/api/leagues/${leagueId}/chat?before=${oldest.id}`);
      const body = (await response.json()) as ApiEnvelope<ChatPageBody>;
      if (!body.ok) {
        setState((prev) => ({ ...prev, error: body.error }));
        return;
      }
      // Deliberately NOT `mergeMessages(messagesRef.current, body.data.messages)` — see this
      // hook's own docblock (carried finding 1). `mergeMessages`'s cap keeps the newest
      // `maxHeldMessages` entries; a backward page fetched via `?before=` is by construction
      // entirely older than everything already held, so once the buffer is at the cap that
      // trim would immediately discard the very page pagination just fetched. The `before`
      // cursor also already guarantees these ids are disjoint from and strictly less than
      // every held id, and the page itself arrives oldest→newest, so a plain prepend is
      // already deduped and already sorted — no need for the shared merge's id-keyed union at
      // all here, only for the live-frame path where overlap and unordered arrival are real.
      const merged = [...body.data.messages, ...messagesRef.current];
      messagesRef.current = merged;
      setState((prev) => ({ ...prev, messages: merged, hasMore: body.data.hasMore, error: null }));
    } catch {
      setState((prev) => ({ ...prev, error: LOAD_ERROR }));
    } finally {
      setState((prev) => ({ ...prev, loadingEarlier: false }));
    }
  }, [deps, leagueId]);

  return { ...state, send, react, loadEarlier, refresh };
}
