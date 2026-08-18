"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface LeagueRoomDeps {
  readonly fetchJson: (url: string, init?: RequestInit) => Promise<Response>;
}

/** Real browser dependency. Tests inject a double rather than mocking a module. */
const BROWSER_DEPS: LeagueRoomDeps = {
  fetchJson: (url, init) => fetch(url, init),
};

const DepsContext = createContext<LeagueRoomDeps>(BROWSER_DEPS);

export function LeagueRoomDepsProvider({ deps, children }: { readonly deps: LeagueRoomDeps; readonly children: ReactNode }) {
  return <DepsContext.Provider value={deps}>{children}</DepsContext.Provider>;
}

export function useLeagueRoomDeps(): LeagueRoomDeps {
  return useContext(DepsContext);
}
