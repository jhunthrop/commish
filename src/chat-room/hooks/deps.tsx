"use client";

import { createContext, useContext, type ReactNode } from "react";

/** The slice of `EventSource` chat uses. Narrow on purpose, so a test double is trivial. */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export interface ChatRoomDeps {
  readonly fetchJson: (url: string, init?: RequestInit) => Promise<Response>;
  readonly openEventSource: (url: string) => EventSourceLike;
}

/**
 * Real browser dependencies. `new EventSource(...)` is constructed lazily inside the factory
 * so importing this module is safe in happy-dom, which has no `EventSource`.
 */
const BROWSER_DEPS: ChatRoomDeps = {
  fetchJson: (url, init) => fetch(url, init),
  openEventSource: (url) => new EventSource(url),
};

const DepsContext = createContext<ChatRoomDeps>(BROWSER_DEPS);

/** Injects test doubles. Production never renders this — the default context value is real. */
export function ChatRoomDepsProvider({ deps, children }: { readonly deps: ChatRoomDeps; readonly children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

export function useChatRoomDeps(): ChatRoomDeps {
  return useContext(DepsContext);
}
