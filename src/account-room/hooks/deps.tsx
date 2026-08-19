"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Mirrors `LeagueRoomDeps`/`ChatRoomDeps`/`DraftRoomDeps` (`src/league-room/hooks/deps.tsx` and
 * siblings): components fetch through an injected `fetchJson`, so a test needs no real network.
 * No `EventSourceLike`/`openEventSource` here — unlike those three rooms, nothing under
 * `src/account-room/**` is realtime, so there is no second dependency to inject.
 */
export interface AccountRoomDeps {
  readonly fetchJson: (url: string, init?: RequestInit) => Promise<Response>;
}

/** Real browser dependency: the platform `fetch`, unmodified. */
const BROWSER_DEPS: AccountRoomDeps = {
  fetchJson: (url, init) => fetch(url, init),
};

const DepsContext = createContext<AccountRoomDeps>(BROWSER_DEPS);

/** Injects test doubles. Production never renders this — the default context value is real. */
export function AccountRoomDepsProvider({ deps, children }: { readonly deps: AccountRoomDeps; readonly children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

export function useAccountRoomDeps(): AccountRoomDeps {
  return useContext(DepsContext);
}
