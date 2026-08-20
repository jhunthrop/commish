"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Mirrors `AccountRoomDeps`/`LeagueRoomDeps` (`src/account-room/hooks/deps.tsx` and siblings):
 * the resolution form fetches through an injected `fetchJson`, so a test needs no real network.
 * No `openEventSource` here — the operator surface has nothing realtime to subscribe to.
 */
export interface AdminRoomDeps {
  readonly fetchJson: (url: string, init?: RequestInit) => Promise<Response>;
}

/** Real browser dependencies. */
const BROWSER_DEPS: AdminRoomDeps = {
  fetchJson: (url, init) => fetch(url, init),
};

const DepsContext = createContext<AdminRoomDeps>(BROWSER_DEPS);

/** Injects test doubles. Production never renders this — the default context value is real. */
export function AdminRoomDepsProvider({ deps, children }: { readonly deps: AdminRoomDeps; readonly children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

export function useAdminRoomDeps(): AdminRoomDeps {
  return useContext(DepsContext);
}
