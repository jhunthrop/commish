"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { useDraftRoomDeps } from "../hooks/deps";
import { forgetAdvisor, recallAdvisor, rememberAdvisor } from "./advisor-memory";

export interface UseAdvisorResult {
  readonly view: AdvisorView | null;
  /** The view that was live during this seat's most recently resolved turn (the post-pick beat's
   *  latch): set the moment a view for a LATER pick lands over one that had `onTheClock`, kept
   *  through every other seat's picks until this seat's next pick resolves. */
  readonly prePickView: AdvisorView | null;
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

interface Held {
  readonly view: AdvisorView | null;
  readonly prePickView: AdvisorView | null;
}

const EMPTY: Held = { view: null, prePickView: null };

/** The next held state after a view lands: the latch moves only when the room itself moved (a
 *  later pick), never on a repeat of the same state. */
export function foldLandedView(held: Held, landed: AdvisorView): Held {
  const previous = held.view;
  const roomMoved = previous === null || landed.stamp.computedAtPick !== previous.stamp.computedAtPick;
  return {
    view: landed,
    prePickView: roomMoved && previous !== null && previous.onTheClock ? previous : held.prePickView,
  };
}

function hydrate(draftId: string): Held {
  const remembered = recallAdvisor(draftId);
  return { view: remembered?.lastView ?? null, prePickView: remembered?.prePickView ?? null };
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
  const [held, setHeld] = useState<Held>(() => hydrate(draftId));
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heldRef = useRef<Held>(held);
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
      heldRef.current = foldLandedView(heldRef.current, body.data);
      setHeld(heldRef.current);
      setError(null);
      rememberAdvisor(draftId, { lastView: heldRef.current.view, prePickView: heldRef.current.prePickView });
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
      heldRef.current = hydrate(draftId);
      setHeld(heldRef.current);
    }
    if (myTeamId === null) {
      heldRef.current = EMPTY;
      setHeld(EMPTY);
      setError(null);
      forgetAdvisor(draftId);
      return;
    }
    recompute();
  }, [draftId, roomKey, myTeamId, recompute]);

  return { view: held.view, prePickView: held.prePickView, recomputing, error };
}
