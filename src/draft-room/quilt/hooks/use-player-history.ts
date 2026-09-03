"use client";

import { useEffect, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { PlayerHistoryBody } from "@/draft-room/contract";
import { useDraftRoomDeps } from "../../hooks/deps";

export type PlayerHistoryState =
  /** No player peeked, or the fetch failed — either way the card renders without the section. */
  | { readonly status: "absent" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly body: PlayerHistoryBody };

/** The room-lifetime cache: playerId → history. Owned by `QuiltRoom` (a ref), shared by the
 *  desktop and phone trees, and never invalidated — a finished season does not change mid-draft. */
export type PlayerHistoryCache = Map<string, PlayerHistoryBody>;

/**
 * The peek's LAZY history fetch (design ruling, 2026-09-02): fires only when a peek actually
 * opens, answers from the cache when the player was peeked before, and treats every failure as
 * absence — the card renders without the section, never with a placeholder. A stale response
 * (the peek moved on while the fetch flew) is dropped, not applied.
 */
export function usePlayerHistory(draftId: string, playerId: string | null, cache: PlayerHistoryCache): PlayerHistoryState {
  const deps = useDraftRoomDeps();
  const [state, setState] = useState<PlayerHistoryState>({ status: "absent" });

  useEffect(() => {
    if (playerId === null) {
      setState({ status: "absent" });
      return;
    }
    const cached = cache.get(playerId);
    if (cached !== undefined) {
      setState({ status: "ready", body: cached });
      return;
    }
    let alive = true;
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await deps.fetchJson(`/api/drafts/${draftId}/players/${playerId}/history`);
        const body = (await response.json()) as ApiEnvelope<PlayerHistoryBody>;
        if (!alive) return;
        if (!body.ok) {
          setState({ status: "absent" });
          return;
        }
        cache.set(playerId, body.data);
        setState({ status: "ready", body: body.data });
      } catch {
        if (alive) setState({ status: "absent" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [deps, draftId, playerId, cache]);

  return state;
}
