"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { NoticesBody, NoticeView } from "../contract";
import { useAccountRoomDeps } from "./deps";

export type NoticesStatus = "loading" | "ready" | "error";

export interface UseNoticesResult {
  readonly notices: readonly NoticeView[];
  /** Derived from `notices` (never a second field to drift): the same bounded page's own
   *  unread count, exactly as `listNotices`' own docblock explains. */
  readonly unreadCount: number;
  readonly status: NoticesStatus;
  readonly error: string | null;
  readonly refetch: () => Promise<void>;
  /** Stamps the given ids read, both on the server and in local state. A no-op for an empty
   *  list — the inbox calls this with "whatever is unread right now", which is often none. */
  readonly markRead: (noticeIds: readonly string[]) => Promise<void>;
}

const CONNECTION_FAILED_MESSAGE = "We couldn't reach the server. Check your connection and try again.";

/**
 * The inbox's one data layer: fetch the caller's own bounded, cursorless page (ruling 22, `GET
 * /api/notices`), subscribe to the caller's own SSE stream, and REFETCH — never fold — on a
 * `notice.created` frame. Ruling 13's other half is why: the frame carries only `{ noticeId,
 * noticeType }`, never the rendered `title`/`body`, so there is nothing in the frame itself a
 * fold could apply. The words come from the next authenticated `GET`.
 *
 * Follows `useLiveScores`'s shape (`src/league-room/hooks/use-live-scores.ts`): one shared
 * `EventSource` via `openEventSource`, a mount fetch, and a refetch on the stream's own `open`
 * to cover the gap between the page's first paint and this hook's listeners attaching. There is
 * no `error` handling here, deliberately: reconnect is the browser's own, and a connection that
 * never opens simply never nudges — the mount fetch and `markRead` both still work over plain
 * HTTP regardless of whether the stream ever connects at all.
 *
 * THREE things write `notices`, uncoordinated: the mount fetch, the `open`-triggered refetch,
 * and the `notice.created`-triggered refetch — plus `markRead`'s own optimistic local update.
 * `generationRef`, the same idiom `useLeagueChat`'s `refreshGeneration` and `useLiveScores`'s
 * `versionRef`/`refreshGeneration` pair use, is ONE counter bumped by every one of those four
 * writes, generalized here to cover a refetch racing `markRead` too, not just two refetches
 * racing each other: a slow `refetch` snapshots the counter before its request goes out, and
 * refuses to apply its response if the counter has moved by the time it resolves. Without this,
 * a mount fetch that happens to still be in flight when the reader opens the panel and marks a
 * notice read would apply LAST and revert that notice back to unread — and because
 * `NoticeInbox`'s own mark-read effect keys off `[open, status]`, a later close/reopen would
 * then see it "unread" again and send a duplicate `POST /api/notices/read` for the same id.
 */
export function useNotices(): UseNoticesResult {
  const deps = useAccountRoomDeps();
  const [notices, setNotices] = useState<readonly NoticeView[]>([]);
  const [status, setStatus] = useState<NoticesStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const refetch = useCallback(async (): Promise<void> => {
    const generationBeforeRequest = generationRef.current;
    try {
      const response = await deps.fetchJson("/api/notices");
      const envelope = (await response.json()) as ApiEnvelope<NoticesBody>;
      if (generationRef.current !== generationBeforeRequest) return; // a newer write already won
      if (!envelope.ok) {
        setStatus("error");
        setError(envelope.error);
        return;
      }
      generationRef.current += 1;
      setNotices(envelope.data.notices);
      setStatus("ready");
      setError(null);
    } catch {
      if (generationRef.current !== generationBeforeRequest) return;
      generationRef.current += 1;
      setStatus("error");
      setError(CONNECTION_FAILED_MESSAGE);
    }
  }, [deps]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  useEffect(() => {
    const source = deps.openEventSource("/api/notices/stream");
    const onFrame = (): void => {
      void refetch();
    };
    source.addEventListener("notice.created", onFrame);
    source.addEventListener("open", onFrame);
    return () => source.close();
  }, [deps, refetch]);

  const markRead = useCallback(
    async (noticeIds: readonly string[]): Promise<void> => {
      if (noticeIds.length === 0) return;
      try {
        await deps.fetchJson("/api/notices/read", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ noticeIds }),
        });
      } catch {
        // Best-effort, same rationale as `deliverNotice`'s own docblock but from the other
        // side: the durable read state lives on the server, and a failed stamp here just
        // means these notices may still show unread on the next real fetch — honest, rather
        // than a local state that quietly disagrees with what the server actually holds.
        return;
      }
      // This LOCAL write wins against any refetch already in flight — bumping the generation
      // here, before applying it, is what makes a slower `refetch` that started earlier refuse
      // to apply its now-stale snapshot on top of this optimistic read.
      generationRef.current += 1;
      const readAt = new Date().toISOString();
      const idSet = new Set(noticeIds);
      setNotices((current) => current.map((notice) => (idSet.has(notice.id) && notice.readAt === null ? { ...notice, readAt } : notice)));
    },
    [deps],
  );

  const unreadCount = notices.filter((notice) => notice.readAt === null).length;

  return { notices, unreadCount, status, error, refetch, markRead };
}
