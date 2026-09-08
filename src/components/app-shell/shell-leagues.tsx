"use client";

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import type { SearchResult } from "@/search/contract";

/**
 * WHICH LEAGUE A PLAYER LINK BELONGS TO (site search round, 2026-09-08).
 *
 * The player analysis page is league-scoped (`/app/leagues/[leagueId]/players/[playerId]`,
 * gated on membership), and there is no league-free player page. So every surface that links a
 * player from OUTSIDE a league — the search overlay, the team page's roster — has to choose one,
 * and this module is the one place that choice is made: the league the reader is standing in when
 * the path says so, else the first league in the shell rail (already in urgency order), else none.
 *
 * THE RAIL IS THREADED, NEVER RE-READ. `AppShell` already holds the rail from the one `shellData`
 * read per navigation; mounting it here as a client context costs no query, which is what keeps
 * "no database statement per keystroke" true for the overlay's links as well as its results.
 *
 * A READER WITH NO LEAGUE GETS THE TEAM PAGE, not a 404: `hrefFor` sends a player result to his
 * club's page, which is league-free and lists him. That is one press short of the dossier and
 * stated as such in the ledger, never a link that dies.
 */

const LEAGUE_PATH = /^\/app\/leagues\/([^/]+)/;

const ShellLeaguesContext = createContext<readonly string[]>([]);

export function ShellLeaguesProvider({ leagueIds, children }: { readonly leagueIds: readonly string[]; readonly children: ReactNode }) {
  return <ShellLeaguesContext.Provider value={leagueIds}>{children}</ShellLeaguesContext.Provider>;
}

/** The league a player link should open in, or `null` when the reader has none. Pure. */
export function leagueForPlayerLinks(pathname: string | null, leagueIds: readonly string[]): string | null {
  const standingIn = pathname === null ? null : LEAGUE_PATH.exec(pathname)?.[1];
  if (standingIn !== null && standingIn !== undefined) return standingIn;
  return leagueIds[0] ?? null;
}

export function teamPageHref(code: string): string {
  return `/app/teams/${code}`;
}

export function playerPageHref(leagueId: string, playerId: string): string {
  return `/app/leagues/${leagueId}/players/${playerId}`;
}

/** Where one search result goes, given the league the links belong to (or none). Pure. */
export function searchResultHref(result: SearchResult, leagueId: string | null): string {
  if (result.kind === "team") return teamPageHref(result.code);
  return leagueId === null ? teamPageHref(result.player.nflTeam) : playerPageHref(leagueId, result.player.id);
}

/** The league the current page's player links belong to, from the path and the shell rail. */
export function useLinkLeague(): string | null {
  const pathname = usePathname();
  const leagueIds = useContext(ShellLeaguesContext);
  return leagueForPlayerLinks(pathname, leagueIds);
}

/** A player's analysis page href for the current reader, or `null` for a reader with no league. */
export function usePlayerPageHref(): (playerId: string) => string | null {
  const leagueId = useLinkLeague();
  return useCallback((playerId: string) => (leagueId === null ? null : playerPageHref(leagueId, playerId)), [leagueId]);
}
