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
 * ONE listener, module scope: `PlayerName` (`player-peek.tsx`) triggers anywhere in the tree
 * reach the single `PlayerPeekHost` the page mounts, with no context threading through the server
 * components between them. A trigger pressed with no host mounted does nothing, quietly — the
 * failure mode is a dead click, never a crash. Lives here (fix round 2: `PlayerPeekHost`'s own
 * under-fifty-line rule) rather than in `player-peek.tsx`, alongside the hook that is its one
 * real reader; `player-peek.tsx` re-exports `openPlayerPeek` unchanged for every existing caller.
 */
let host: ((target: PeekTarget) => void) | null = null;

export function openPlayerPeek(target: PeekTarget): void {
  host?.(target);
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
export function usePeekLoad(): PeekLoadState {
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
    host = openTarget;
    return () => {
      if (host === openTarget) host = null;
    };
  }, []);

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
