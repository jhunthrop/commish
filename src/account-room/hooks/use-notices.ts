"use client";

import { useEffect } from "react";
import { useNoticesContext, type UseNoticesResult } from "@/components/app-shell/notices-provider";

export type { NoticesStatus, UseNoticesResult } from "@/components/app-shell/notices-provider";

/**
 * The inbox's one data layer: fetch the caller's own bounded, cursorless page (ruling 22, `GET
 * /api/notices`), subscribe to the caller's own SSE stream, and REFETCH — never fold — on a
 * `notice.created` frame. Ruling 13's other half is why: the frame carries only `{ noticeId,
 * noticeType }`, never the rendered `title`/`body`, so there is nothing in the frame itself a
 * fold could apply. The words come from the next authenticated `GET`.
 *
 * Plan D Task 9 moved the actual fetch/stream/state out of this hook and into `NoticesProvider`
 * (`@/components/app-shell/notices-provider`), mounted once in `src/app/layout.tsx` so its state
 * outlives every client-side navigation. This hook keeps its name and its `UseNoticesResult`
 * shape — including the `generationRef` guard's real race between a mount fetch and `markRead`,
 * documented on the provider now that it owns the state — but is now a `useContext` read plus one
 * subscribe effect: mounting calls `context.subscribe()`, which is idempotent and fires the
 * provider's mount fetch and its stream's `open` only the FIRST time, ever, that anything calls
 * it — so the provider's presence costs nothing until an inbox actually exists on screen.
 *
 * REQUIRES a `NoticesProvider` ancestor and throws a clear message if there isn't one — the same
 * "no silent standalone fallback" idiom `useTheme`/`useToast` already use in this codebase
 * (`@/design/theme-provider`, `@/components/ui/toast`). No page in this product reaches
 * `NoticeInbox`/`AppHeader` outside the root layout that mounts `NoticesProvider`:
 * `src/app/error.tsx`, `src/app/global-error.tsx` and `not-found.tsx` all render neither. A
 * caller with no provider ancestor is a wiring bug, not a state this hook should quietly paper
 * over with a second, competing implementation.
 */
export function useNotices(): UseNoticesResult {
  const context = useNoticesContext();
  if (context === null) throw new Error("useNotices must be used inside <NoticesProvider>.");
  const { subscribe } = context;

  useEffect(() => subscribe(), [subscribe]);

  return context;
}
