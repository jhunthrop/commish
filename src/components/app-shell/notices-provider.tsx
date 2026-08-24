"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { NoticesBody, NoticeView } from "@/account-room/contract";
import { useAccountRoomDeps } from "@/account-room/hooks/deps";

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

/** The context value carries one extra member beyond `UseNoticesResult`: `subscribe`, the seam
 *  `useNotices()` (`@/account-room/hooks/use-notices`) calls from a mount effect so the FIRST
 *  real consumer — not the provider's own mount — is what starts the fetch and opens the
 *  stream. Not part of `UseNoticesResult` itself: that type is the public shape every existing
 *  caller of `useNotices()` already depends on, and `subscribe` is this file's own internal
 *  wiring, not something a page ever calls directly. */
export interface NoticesContextValue extends UseNoticesResult {
  /** Idempotent: the first call, ever, starts the mount fetch and opens the shared stream
   *  (`start`'s own `startedRef` guard); every later call — including the one a page mounted a
   *  SECOND `NoticeInbox` would make, or a page mounted after a draft-room trip with none at all
   *  — is a no-op. No unsubscribe half: unlike `subscribeLeagueStream`'s refcount idiom
   *  (`@/event-stream/league-stream`), which closes a connection when its last subscriber
   *  leaves, this provider never closes anything — see `start`'s own docblock for why the two
   *  idioms diverge past "when does the first fetch fire". */
  readonly subscribe: () => void;
}

const NoticesContext = createContext<NoticesContextValue | null>(null);

const CONNECTION_FAILED_MESSAGE = "We could not reach the server. Check your connection and try again.";

/**
 * The inbox's data layer, moved here from `useNotices` (Plan D Task 9) so its STATE outlives
 * every client-side navigation instead of remounting — and refetching — on each one. Ruling 10
 * is why this lives beside `ThemeProvider` in `src/app/layout.tsx` rather than in a shared
 * `src/app/app/layout.tsx`: the draft room's `RoomRail` IS its header under a no-page-scroll
 * contract, and the invite page is the one page under `/app` a signed-out visitor reaches
 * (`middleware.ts`'s single exemption) — a layout that rendered `TopBar` would break the
 * first visually and the second functionally. This component renders NEITHER: it is mounted on
 * EVERY page in the product, including both of those, so it can only be provider logic, never
 * presentation. `NoticeInbox` (`@/account-room/components/notice-inbox`) is unchanged.
 *
 * Fetches and streams NOTHING on its own mount. `AccountRoomDepsProvider`'s default context
 * value is already the real browser deps, so this provider is safe to mount on a signed-out
 * landing page, `/sign-in`, or the signed-out half of the invite page — a mount-triggered fetch
 * there would send an authenticated request from every signed-out visitor for nothing.
 * `subscribe` is the seam: the FIRST call, ever, for the life of this provider instance, fires
 * the mount fetch and opens the shared stream; the moment nothing subscribes (nobody signed in
 * ever renders `NoticeInbox`), nothing fires at all. That is the whole mechanism behind "no
 * fetch storms, no 401 noise" — there is no auth check in this file, because there does not
 * need to be one.
 */
export function NoticesProvider({ children }: { readonly children: ReactNode }) {
  const deps = useAccountRoomDeps();
  const [notices, setNotices] = useState<readonly NoticeView[]>([]);
  const [status, setStatus] = useState<NoticesStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);
  /** Ever started, once, for the life of this provider — NOT tied to how many `NoticeInbox`es
   *  are mounted right now, which is what makes navigating into the draft room and back out cost
   *  nothing: the state this provider already holds stays held, and `start` never runs a second
   *  time to refetch it. */
  const startedRef = useRef(false);

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

  const start = useCallback((): void => {
    if (startedRef.current) return;
    startedRef.current = true;
    void refetch();
    // ONE `EventSource` for the whole tab, opened once and never closed on navigation —
    // deliberately NOT `subscribeLeagueStream`'s own "last one out closes it" half. That idiom
    // exists because a league room's consumers come and go while OTHER pages are still open in
    // other tabs; this provider IS the root layout, mounted for the life of the tab, so there is
    // no earlier moment closing it would be correct, and no later one either — it dies with the
    // tab, the same way `ThemeProvider` beside it does.
    const source = deps.openEventSource("/api/notices/stream");
    const onFrame = (): void => void refetch();
    source.addEventListener("notice.created", onFrame);
    source.addEventListener("open", onFrame);
  }, [deps, refetch]);

  const subscribe = useCallback((): void => {
    start();
  }, [start]);

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

  const value: NoticesContextValue = { notices, unreadCount, status, error, refetch, markRead, subscribe };

  return <NoticesContext.Provider value={value}>{children}</NoticesContext.Provider>;
}

/** `null` when rendered with no `NoticesProvider` ancestor. `useNotices()`
 *  (`@/account-room/hooks/use-notices`) is the one caller of this and throws on `null` — same
 *  "no silent fallback" idiom `useTheme`/`useToast` already use in this codebase — rather than
 *  quietly running a second, competing implementation of the state this provider owns. */
export function useNoticesContext(): NoticesContextValue | null {
  return useContext(NoticesContext);
}
