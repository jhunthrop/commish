"use client";

import { useEffect, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { PlayerSeasonBody } from "@/league-service/player";
import { useLeagueRoomDeps } from "../hooks/deps";

export interface PeekTarget {
  readonly leagueId: string;
  readonly playerId: string;
  readonly name: string;
}

/**
 * WHICH HOST A PRESS REACHES, when more than one is mounted.
 *
 * `"shell"` is the app frame's own host (`AppShell`), mounted once for every signed-in page, which
 * is why no page mounts one of its own any more. `"surface"` is a host a surface mounts because
 * the shell's would be wrong for it — today only the draft room, which lives outside the shell's
 * route group and owns a viewport that must not gain a scrolling child.
 *
 * A SURFACE HOST ALWAYS WINS, and that is a precedence rule rather than a mount-order one on
 * purpose: React runs a child's effects BEFORE its parent's, so "the last one to register wins"
 * would hand a full page load to the outer host and an in-app navigation to the inner one — the
 * same tree behaving differently depending on how the reader arrived. Roles cannot do that.
 */
export type PeekHostScope = "shell" | "surface";

/**
 * The mounted listeners, module scope: `PlayerName` (`player-peek.tsx`) triggers anywhere in the
 * tree reach them with no context threading through the server components between. A trigger
 * pressed with no host at all does nothing, quietly — the failure mode is a dead click, never a
 * crash. Lives here (fix round 2: `PlayerPeekHost`'s own under-fifty-line rule) rather than in
 * `player-peek.tsx`, alongside the hook that is its one real reader; `player-peek.tsx` re-exports
 * `openPlayerPeek` unchanged for every existing caller.
 */
const hosts = new Map<PeekHostScope, (target: PeekTarget) => void>();

/**
 * Raises the peek, and SAYS WHETHER IT COULD (Sideline research round). Every caller before that
 * round was a player name inside a league surface, so a dead click was only ever a bug. Site
 * search is reachable from every signed-in page, and a search result that silently did nothing
 * would be the worst failure on the surface. `false` means nobody took it, and the caller
 * navigates to the full page instead — still the honest answer on a page outside the shell
 * entirely, such as the public TV board.
 */
export function openPlayerPeek(target: PeekTarget): boolean {
  const host = hosts.get("surface") ?? hosts.get("shell");
  if (host === undefined) return false;
  host(target);
  return true;
}

/** Test seam: a module-scope registry outlives a single test the way a rate limiter does. */
export function resetPlayerPeekHostsForTests(): void {
  hosts.clear();
}

export interface PeekLoadState {
  readonly target: PeekTarget | null;
  readonly body: PlayerSeasonBody | null;
  readonly failed: boolean;
  /** `null` means "let the service pick" — its own default, the newest season with data for
   *  him. Set only once a manager presses a segment in the switcher (2026-09-04 widening). */
  readonly season: number | null;
  readonly setSeason: (season: number | null) => void;
  /** Closes the sheet — the one thing both the header's own link and the sheet's own close
   *  button need to do. */
  readonly close: () => void;
}

/**
 * THE PEEK'S OWN LOAD HALF (fix round 2, extracted from `PlayerPeekHost` so that component is
 * left with only its own composition to render — the under-fifty-line rule). Registers itself as
 * the module's one `host` listener, fetches the player's season under this league's rules on
 * every target/season change (the same body the full page reads), and resets the season pick
 * whenever a NEW target opens — a manager's season choice on one player's card has no business
 * surviving onto the next name pressed. No behavior change from the version this replaced:
 * byte-identical effects, state and cleanup, just named and returned rather than inlined.
 */
export function usePeekLoad(scope: PeekHostScope): PeekLoadState {
  const { fetchJson } = useLeagueRoomDeps();
  const [target, setTarget] = useState<PeekTarget | null>(null);
  const [body, setBody] = useState<PlayerSeasonBody | null>(null);
  const [failed, setFailed] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  useEffect(() => {
    // Opening a new target resets any season a prior peek's manager had picked.
    const openTarget = (next: PeekTarget) => {
      setSeason(null);
      setTarget(next);
    };
    hosts.set(scope, openTarget);
    return () => {
      // Only if it is still MINE: the draft room swaps between two hosts of the same role across
      // a phase change, and React mounts the arriving one before unmounting the departing one, so
      // an unconditional delete here would leave the role empty and every name dead.
      if (hosts.get(scope) === openTarget) hosts.delete(scope);
    };
  }, [scope]);

  useEffect(() => {
    if (target === null) return;
    setBody(null);
    setFailed(false);
    let alive = true;
    void (async () => {
      try {
        const seasonParam = season === null ? "" : `&season=${season}`;
        const response = await fetchJson(
          `/api/leagues/${target.leagueId}/player-season?playerId=${encodeURIComponent(target.playerId)}${seasonParam}`,
          { method: "GET" },
        );
        const envelope = (await response.json()) as ApiEnvelope<PlayerSeasonBody>;
        if (!alive) return;
        if (envelope.ok) setBody(envelope.data);
        else setFailed(true);
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [target, season, fetchJson]);

  return { target, body, failed, season, setSeason, close: () => setTarget(null) };
}
