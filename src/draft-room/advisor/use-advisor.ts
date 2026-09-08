"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { AdvisorView } from "@/draft-service/assistant/view";
import { useDraftRoomDeps } from "../hooks/deps";
import { forgetAdvisor, recallAdvisor, rememberAdvisor } from "./advisor-memory";

export interface UseAdvisorResult {
  /** The held view, shown only for candidates still on the room's board at render time
   *  (`presentView`): a name the room has since drafted never reaches the card or a row. */
  readonly view: AdvisorView | null;
  /** The view that was live during this seat's most recently resolved turn (the post-pick beat's
   *  latch): set the moment a view for a LATER pick lands over one that had `onTheClock`, kept
   *  through every other seat's picks until this seat's next pick resolves. Kept as computed —
   *  it is a record of that turn, not a recommendation. */
  readonly prePickView: AdvisorView | null;
  /** True while a recompute is in flight, or while the held view's stamp is older than the
   *  room's own sequence (a fresh one is on its way). The previous view keeps rendering; never a
   *  blank. */
  readonly recomputing: boolean;
  readonly error: string | null;
}

/** The room as the advisor reads it: which draft, the log sequence the client holds right now,
 *  and every player still on the board — all off the `DraftStateView` the room already has. */
export interface AdvisorRoom {
  readonly draftId: string;
  readonly sequence: number;
  readonly availablePlayerIds: ReadonlySet<string>;
}

const NETWORK_ERROR = "We couldn't reach the advisor. Check your connection and try again.";

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

function pickEntries<T>(record: Readonly<Record<string, T>>, keep: ReadonlySet<string>): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([playerId]) => keep.has(playerId)));
}

/**
 * THE WRONG-PEOPLE GUARD (founder report 2026-09-08): a view computed at one state, rendered
 * against a later one. The card's pick, every odds row and every tier row are kept only for
 * players still on the room's board right now; a candidate drafted between compute and render
 * drops out here, whatever the server said. The stamp is untouched — the view still says what
 * state it was computed at.
 */
export function presentView(view: AdvisorView, available: ReadonlySet<string>): AdvisorView {
  return {
    ...view,
    pick: view.pick !== null && available.has(view.pick.playerId) ? view.pick : null,
    odds: view.odds === null ? null : { ...view.odds, survived: pickEntries(view.odds.survived, available) },
    tiers: pickEntries(view.tiers, available),
  };
}

function hydrate(draftId: string): Held {
  const remembered = recallAdvisor(draftId);
  return { view: remembered?.lastView ?? null, prePickView: remembered?.prePickView ?? null };
}

/**
 * THE ADVISOR'S FETCH — spec 3.4: `GET /api/drafts/:draftId/assistant` on every change of the
 * room's log sequence, which every pick event (and every other applied action) moves.
 * `myTeamId === null` never fetches: a commissioner has no seat to advise.
 *
 * COALESCED, NEVER PILED UP (simplification round): the request carries no state of its own,
 * the server always answers from the room's CURRENT state, so a pick event that lands while a
 * request is in flight only marks the hook dirty, and exactly one more request follows when the
 * current one lands. The lag the founder measured was requests queued behind each other on the
 * server, one per pick event, each computing a state nobody would see.
 */
export function useAdvisor(room: AdvisorRoom, myTeamId: string | null): UseAdvisorResult {
  const { draftId, sequence, availablePlayerIds } = room;
  const deps = useDraftRoomDeps();
  const [held, setHeld] = useState<Held>(() => hydrate(draftId));
  const [inFlight, setInFlight] = useState(false);
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
    setInFlight(true);
    void (async () => {
      do {
        dirtyRef.current = false;
        await fetchOnce();
      } while (aliveRef.current && dirtyRef.current);
      inFlightRef.current = false;
      if (aliveRef.current) setInFlight(false);
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
  }, [draftId, sequence, myTeamId, recompute]);

  const view = useMemo(() => (held.view === null ? null : presentView(held.view, availablePlayerIds)), [held.view, availablePlayerIds]);
  const stale = held.view !== null && held.view.stamp.sequence < sequence;
  return { view, prePickView: held.prePickView, recomputing: inFlight || stale, error };
}
