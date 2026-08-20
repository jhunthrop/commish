"use client";

import { createContext, useContext, type ReactNode } from "react";
import { subscribeLeagueStream } from "@/event-stream/league-stream";

/** The slice of `EventSource` the notice inbox uses. Narrow on purpose, so a test double is
 *  trivial — mirrors `LeagueRoomDeps`/`ChatRoomDeps`'s own `EventSourceLike`. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

/**
 * Mirrors `LeagueRoomDeps`/`ChatRoomDeps`/`DraftRoomDeps` (`src/league-room/hooks/deps.tsx` and
 * siblings): components fetch through an injected `fetchJson`, so a test needs no real network.
 *
 * `openEventSource` joined this interface for Task 10's notice inbox — the first realtime
 * consumer under `src/account-room/**`. It carries the SAME `subscribeLeagueStream` manager the
 * three league-scoped rooms already share (see that module's own docblock): the manager is
 * keyed by connection URL, not by any league concept, so `/api/notices/stream` shares its
 * ref-counting and its `open`/`error` replay exactly like `/api/leagues/[id]/events` does — a
 * second, near-identical registry would just be the same 100 lines with a different name.
 */
export interface AccountRoomDeps {
  readonly fetchJson: (url: string, init?: RequestInit) => Promise<Response>;
  readonly openEventSource: (url: string) => EventSourceLike;
}

/** Real browser dependencies. The connection is constructed lazily inside the factory, so
 *  importing this module is safe in happy-dom, which has no `EventSource`. */
const BROWSER_DEPS: AccountRoomDeps = {
  fetchJson: (url, init) => fetch(url, init),
  openEventSource: (url) => subscribeLeagueStream(url),
};

const DepsContext = createContext<AccountRoomDeps>(BROWSER_DEPS);

/** Injects test doubles. Production never renders this — the default context value is real. */
export function AccountRoomDepsProvider({ deps, children }: { readonly deps: AccountRoomDeps; readonly children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

export function useAccountRoomDeps(): AccountRoomDeps {
  return useContext(DepsContext);
}
