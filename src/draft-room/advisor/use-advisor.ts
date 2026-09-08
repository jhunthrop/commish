"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { AdvisorView, DraftPlan } from "@/draft-service/assistant/view";
import { useDraftRoomDeps } from "../hooks/deps";
import { forgetAdvisor, recallAdvisor, rememberAdvisor } from "./advisor-memory";
import { ADVISOR_ROOM_CONFIG } from "./config";

export interface UseAdvisorResult {
  readonly view: AdvisorView | null;
  /** The plan the manager was looking at before the room last moved, for "changed since". */
  readonly previousPlan: DraftPlan | null;
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
  readonly previousPlan: DraftPlan | null;
}

/** The next held state after a view lands: the latch and the previous plan move only when the
 *  room itself moved (a later pick), never on a voice re-poll of the same state. */
export function foldLandedView(held: Held, landed: AdvisorView): Held {
  const previous = held.view;
  const roomMoved = previous === null || landed.stamp.computedAtPick !== previous.stamp.computedAtPick;
  return {
    view: landed,
    prePickView: roomMoved && previous !== null && previous.onTheClock ? previous : held.prePickView,
    previousPlan: roomMoved && previous !== null ? previous.plan : held.previousPlan,
  };
}

/**
 * THE ADVISOR'S FETCH — spec 3.4: one `GET /api/drafts/:draftId/assistant` per `roomKey` change,
 * which the caller derives from every pick event the room streams (not the pick number alone,
 * the staleness bug this replaces), plus a re-poll while the writer's answer is `pending`.
 * `myTeamId === null` never fetches: a commissioner has no seat to advise.
 */
export function useAdvisor(draftId: string, roomKey: string, myTeamId: string | null): UseAdvisorResult {
  const deps = useDraftRoomDeps();
  const remembered = recallAdvisor(draftId);
  const initial: Held = { view: remembered?.lastView ?? null, prePickView: remembered?.prePickView ?? null, previousPlan: remembered?.previousPlan ?? null };
  const [held, setHeld] = useState<Held>(initial);
  const [recomputing, setRecomputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const heldRef = useRef<Held>(initial);
  const draftIdRef = useRef<string | null>(null);
  const [pollTick, setPollTick] = useState(0);

  useEffect(() => {
    if (draftIdRef.current !== draftId) {
      const previousDraftId = draftIdRef.current;
      draftIdRef.current = draftId;
      if (previousDraftId !== null) forgetAdvisor(previousDraftId);
      const hydrated = recallAdvisor(draftId);
      heldRef.current = { view: hydrated?.lastView ?? null, prePickView: hydrated?.prePickView ?? null, previousPlan: hydrated?.previousPlan ?? null };
      setHeld(heldRef.current);
    }

    if (myTeamId === null) {
      heldRef.current = { view: null, prePickView: null, previousPlan: null };
      setHeld(heldRef.current);
      setRecomputing(false);
      setError(null);
      forgetAdvisor(draftId);
      return;
    }

    let alive = true;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    setRecomputing(true);
    void (async () => {
      try {
        const response = await deps.fetchJson(`/api/drafts/${draftId}/assistant`);
        const body = (await response.json()) as ApiEnvelope<AdvisorView>;
        if (!alive) return;
        if (!body.ok) {
          setError(body.error);
          setRecomputing(false);
          return;
        }
        heldRef.current = foldLandedView(heldRef.current, body.data);
        setHeld(heldRef.current);
        setError(null);
        setRecomputing(false);
        rememberAdvisor(draftId, { lastView: heldRef.current.view, prePickView: heldRef.current.prePickView, previousPlan: heldRef.current.previousPlan });
        if (body.data.voice.status === "pending") pollTimer = setTimeout(() => setPollTick((tick) => tick + 1), ADVISOR_ROOM_CONFIG.voicePollMs);
      } catch {
        if (alive) {
          setError(NETWORK_ERROR);
          setRecomputing(false);
        }
      }
    })();
    return () => {
      alive = false;
      if (pollTimer !== null) clearTimeout(pollTimer);
    };
  }, [deps, draftId, roomKey, myTeamId, pollTick]);

  return { view: held.view, previousPlan: held.previousPlan, prePickView: held.prePickView, recomputing, error };
}
