"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import { useNoticesContext, type UseNoticesResult } from "@/components/app-shell/notices-provider";
import type { NoticesBody, NoticeView } from "../contract";
import { useAccountRoomDeps } from "./deps";

export type { NoticesStatus, UseNoticesResult } from "@/components/app-shell/notices-provider";

const CONNECTION_FAILED_MESSAGE = "We couldn't reach the server. Check your connection and try again.";

/**
 * The pre-Task-9 implementation, kept verbatim as a FALLBACK for a caller with no
 * `NoticesProvider` ancestor. In production this branch is dead: `src/app/layout.tsx` always
 * renders `NoticesProvider`, so every real page finds a context value. It stays here so every
 * test that renders `NoticeInbox`/`AppHeader` (or a page containing either) wrapped in only
 * `AccountRoomDepsProvider` — which is most of them, across `src/app/app/**` — keeps passing
 * with no changes of its own: `useNotices()` behaves exactly as it did before this task for a
 * caller that never opted into the shared provider.
 *
 * `enabled` gates every effect's BODY, not whether the hooks below are called at all — Rules of
 * Hooks requires the same hooks in the same order on every render, so `useNotices()` always
 * calls this, and this always calls `useState`/`useEffect` the same number of times regardless
 * of `enabled`. When a `NoticesProvider` ancestor exists, `enabled` is `false` for the life of
 * the component: this function's own state stays at its unused initial values and its effects
 * no-op, while the REAL state comes from the context instead.
 */
function useStandaloneNotices(enabled: boolean): UseNoticesResult {
  const deps = useAccountRoomDeps();
  const [notices, setNotices] = useState<readonly NoticeView[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const refetch = useCallback(async (): Promise<void> => {
    if (!enabled) return;
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
  }, [deps, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refetch();
  }, [enabled, refetch]);

  useEffect(() => {
    if (!enabled) return undefined;
    const source = deps.openEventSource("/api/notices/stream");
    const onFrame = (): void => {
      void refetch();
    };
    source.addEventListener("notice.created", onFrame);
    source.addEventListener("open", onFrame);
    return () => source.close();
  }, [enabled, deps, refetch]);

  const markRead = useCallback(
    async (noticeIds: readonly string[]): Promise<void> => {
      if (!enabled || noticeIds.length === 0) return;
      try {
        await deps.fetchJson("/api/notices/read", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ noticeIds }),
        });
      } catch {
        return;
      }
      generationRef.current += 1;
      const readAt = new Date().toISOString();
      const idSet = new Set(noticeIds);
      setNotices((current) => current.map((notice) => (idSet.has(notice.id) && notice.readAt === null ? { ...notice, readAt } : notice)));
    },
    [deps, enabled],
  );

  const unreadCount = notices.filter((notice) => notice.readAt === null).length;

  return { notices, unreadCount, status, error, refetch, markRead };
}

/**
 * The inbox's one data layer: fetch the caller's own bounded, cursorless page (ruling 22, `GET
 * /api/notices`), subscribe to the caller's own SSE stream, and REFETCH — never fold — on a
 * `notice.created` frame. Ruling 13's other half is why: the frame carries only `{ noticeId,
 * noticeType }`, never the rendered `title`/`body`, so there is nothing in the frame itself a
 * fold could apply. The words come from the next authenticated `GET`.
 *
 * Plan D Task 9 moved the actual fetch/stream/state out of this hook and into
 * `NoticesProvider` (`@/components/app-shell/notices-provider`), mounted once in
 * `src/app/layout.tsx` so its state outlives every client-side navigation. This hook keeps its
 * name, its `UseNoticesResult` shape, and every one of its callers' expectations — including
 * the `generationRef` guard's real race between a mount fetch and `markRead` — but is now a
 * `useContext` read plus one subscribe effect: the subscriber COUNT is what triggers the
 * provider's first fetch, mirroring `subscribeLeagueStream`'s own refcount idiom, so the
 * provider's presence costs nothing until an inbox actually exists on screen.
 *
 * `useStandaloneNotices` is the fallback for a caller with no `NoticesProvider` ancestor — see
 * its own docblock. THREE things write `notices` in the provider path, uncoordinated: the mount
 * fetch, the `open`-triggered refetch, and the `notice.created`-triggered refetch — plus
 * `markRead`'s own optimistic local update. `generationRef` there is ONE counter bumped by every
 * one of those four writes: a slow `refetch` snapshots the counter before its request goes out,
 * and refuses to apply its response if the counter has moved by the time it resolves. Without
 * this, a mount fetch still in flight when the reader opens the panel and marks a notice read
 * would apply LAST and revert that notice back to unread.
 */
export function useNotices(): UseNoticesResult {
  const context = useNoticesContext();
  const fallback = useStandaloneNotices(context === null);

  const subscribe = context?.subscribe;
  useEffect(() => {
    if (subscribe === undefined) return undefined;
    return subscribe();
  }, [subscribe]);

  return context ?? fallback;
}
