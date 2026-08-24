"use client";

import { createContext, useContext, type ReactNode } from "react";
import { fetchWithSessionWatch } from "@/components/app-shell/session-watch";

/**
 * Mirrors `AccountRoomDeps`/`LeagueRoomDeps` (`src/account-room/hooks/deps.tsx` and siblings):
 * the resolution form fetches through an injected `fetchJson`, so a test needs no real network.
 * No `openEventSource` here — the operator surface has nothing realtime to subscribe to.
 */
export interface AdminRoomDeps {
  readonly fetchJson: (url: string, init?: RequestInit) => Promise<Response>;
}

/** Real browser dependencies. `fetchJson` is a one-line delegate to `fetchWithSessionWatch`
 *  (Task 16, Step 5) — same signature, same return value, so every existing caller keeps
 *  working unchanged, and a `401` in our own envelope shape now also reaches the shared
 *  session-lost recovery. A19's own carry, closed here: an operator's `resolve` submission is a
 *  WRITE (`ResolutionForm`/`HeldTradeDetail`'s `POST /api/admin/flags/[flagId]/resolve`), and a
 *  session that died mid-decision used to fail as an ordinary "We could not reach the server"
 *  message — indistinguishable from a real network error — instead of the honest "Nothing you
 *  typed was sent." modal every other write surface already shows. `SessionNotice` needs no
 *  placement work here: admin pages are shell pages, and `TopBar` already renders it once for
 *  the whole route group (Task 2 Step 5). */
const BROWSER_DEPS: AdminRoomDeps = {
  fetchJson: (url, init) => fetchWithSessionWatch(url, init),
};

const DepsContext = createContext<AdminRoomDeps>(BROWSER_DEPS);

/** Injects test doubles. Production never renders this — the default context value is real. */
export function AdminRoomDepsProvider({ deps, children }: { readonly deps: AdminRoomDeps; readonly children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

export function useAdminRoomDeps(): AdminRoomDeps {
  return useContext(DepsContext);
}
