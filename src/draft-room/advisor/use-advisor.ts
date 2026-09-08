"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { useDraftRoomDeps } from "../hooks/deps";
import { forgetAdvisor, recallAdvisor, rememberAdvisor } from "./advisor-memory";

export interface UseAdvisorResult {
  readonly view: AdvisorView | null;
  /** True while a recompute is in flight. The previous view keeps rendering; never a blank. */
  readonly recomputing: boolean;
  readonly error: string | null;
}

const NETWORK_ERROR = "We couldn't reach the advisor. Check your connection and try again.";

/** The room's own key for "something a pick event can change": a pick landing or the clock
 *  advancing. Computed by the caller from the room view it already holds. */
export function advisorRoomKey(picksCount: number, pickNumber: number): string {
  return `${picksCount}:${pickNumber}`;
}

function hydrate(draftId: string): AdvisorView | null {
  return recallAdvisor(draftId)?.lastView ?? null;
}

/**
 * THE ADVISOR'S FETCH — spec 3.4: `GET /api/drafts/:draftId/assistant` on every `roomKey`
 * change, which the caller derives from every pick event the room streams. `myTeamId === null`
 * never fetches: a commissioner has no seat to advise.
 *
 * COALESCED, NEVER PILED UP (simplification round): the request carries no state of its own,
 * the server always answers from the room's CURRENT state, so a pick event that lands while a
 * request is in flight only marks the hook dirty, and exactly one more request follows when the
 * current one lands. The lag the founder measured was requests queued behind each other on the
 * server, one per pick event, each computing a state nobody would see.
 */
export function useAdvisor(draftId: string, roomKey: string, myTeamId: string | null): UseAdvisorResult {
  const deps = useDraftRoomDeps();
  const [view, setView] = useState<AdvisorView | null>(() => hydrate(draftId));
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftIdRef = useRef<string>(draftId);
  const aliveRef = useRef(true);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);

  const fetchOnce = useCallback(async (): Promise<void> => {
    try {
      const response = await deps.fetchJson(`/api/drafts/${draftId}/assistant`);
      const body = (await response.json()) as ApiEnvelope<AdvisorView>;
      if (!aliveRef.current) return;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setView(body.data);
      setError(null);
      rememberAdvisor(draftId, { lastView: body.data });
    } catch {
      if (aliveRef.current) setError(NETWORK_ERROR);
    }
  }, [deps, draftId]);

  const recompute = useCallback((): void => {
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }
    inFlightRef.current = true;
    setRecomputing(true);
    void (async () => {
      do {
        dirtyRef.current = false;
        await fetchOnce();
      } while (aliveRef.current && dirtyRef.current);
      inFlightRef.current = false;
      if (aliveRef.current) setRecomputing(false);
    })();
  }, [fetchOnce]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (draftIdRef.current !== draftId) {
      forgetAdvisor(draftIdRef.current);
      draftIdRef.current = draftId;
      setView(hydrate(draftId));
    }
    if (myTeamId === null) {
      setView(null);
      setError(null);
      forgetAdvisor(draftId);
      return;
    }
    recompute();
  }, [draftId, roomKey, myTeamId, recompute]);

  return { view, recomputing, error };
}
