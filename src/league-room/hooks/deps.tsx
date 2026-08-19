"use client";

import { createContext, useContext, type ReactNode } from "react";
import { subscribeLeagueStream } from "@/event-stream/league-stream";

/** The slice of `EventSource` live scoring uses. Narrow on purpose, so a test double is trivial. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface LeagueRoomDeps {
  readonly fetchJson: (url: string, init?: RequestInit) => Promise<Response>;
  readonly openEventSource: (url: string) => EventSourceLike;
}

/**
 * Real browser dependencies. The stream is the SHARED one from `@/event-stream`, not a
 * connection of the league room's own — mirrors `ChatRoomDeps`/`DraftRoomDeps` (see their own
 * docblocks): a league page can mount `useLiveScores` alongside `useLeagueChat`, and one
 * `EventSource` per url serves both. The connection is still constructed lazily inside the
 * factory, so importing this module is safe in happy-dom, which has no `EventSource`.
 */
const BROWSER_DEPS: LeagueRoomDeps = {
  fetchJson: (url, init) => fetch(url, init),
  openEventSource: (url) => subscribeLeagueStream(url),
};

const DepsContext = createContext<LeagueRoomDeps>(BROWSER_DEPS);

export function LeagueRoomDepsProvider({ deps, children }: { readonly deps: LeagueRoomDeps; readonly children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

export function useLeagueRoomDeps(): LeagueRoomDeps {
  return useContext(DepsContext);
}
