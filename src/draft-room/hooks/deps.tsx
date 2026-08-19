"use client";

import { createContext, useContext, type ReactNode } from "react";
import { subscribeLeagueStream } from "@/event-stream/league-stream";

/** The slice of `EventSource` the room uses. Narrow on purpose, so a test double is trivial. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface DraftRoomDeps {
  readonly fetchJson: (url: string, init?: RequestInit) => Promise<Response>;
  readonly openEventSource: (url: string) => EventSourceLike;
}

/**
 * Real browser dependencies. The stream is the SHARED one from `@/event-stream`, not a
 * connection of the draft room's own: the room also mounts `useLeagueChat` on the same league
 * stream, and one `EventSource` per url serves both (see that module's docblock). The
 * connection is still constructed lazily inside the factory, so importing this module is safe
 * in happy-dom, which has no `EventSource`.
 */
const BROWSER_DEPS: DraftRoomDeps = {
  fetchJson: (url, init) => fetch(url, init),
  openEventSource: (url) => subscribeLeagueStream(url),
};

const DepsContext = createContext<DraftRoomDeps>(BROWSER_DEPS);

/** Injects test doubles. Production never renders this — the default context value is real. */
export function DraftRoomDepsProvider({ deps, children }: { readonly deps: DraftRoomDeps; readonly children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

export function useDraftRoomDeps(): DraftRoomDeps {
  return useContext(DepsContext);
}
