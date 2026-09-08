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

function pickEntries<T>(record: Readonly<Record<string, T>>, keep: ReadonlySet<string>): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([playerId]) => keep.has(playerId)));
}

/**
 * THE WRONG-PEOPLE GUARD (founder report 2026-09-08): a view computed at one state, rendered
 * against a later one. The card's pick, the candidate rows, every odds row and every tier row
 * are kept only for players still on the room's board right now; a candidate drafted between
 * compute and render drops out here, whatever the server said. `candidates[0]` IS the card's
 * pick (the rows are the rest), so a drafted lead empties the list with it — the wire's own
 * "empty exactly when `pick` is null" — rather than promoting a row into a card whose sentence
 * was written about someone else. The stamp is untouched: the view still says what state it
 * was computed at.
 */
export function presentView(view: AdvisorView, available: ReadonlySet<string>): AdvisorView {
  const leadStands = view.pick !== null && available.has(view.pick.playerId);
  return {
    ...view,
    pick: leadStands ? view.pick : null,
    candidates: leadStands ? view.candidates.filter((candidate) => available.has(candidate.playerId)) : [],
    odds: view.odds === null ? null : { ...view.odds, survived: pickEntries(view.odds.survived, available) },
    tiers: pickEntries(view.tiers, available),
  };
}

function hydrate(draftId: string): AdvisorView | null {
  return recallAdvisor(draftId)?.lastView ?? null;
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
  const [held, setHeld] = useState<AdvisorView | null>(() => hydrate(draftId));
  const [inFlight, setInFlight] = useState(false);
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
      setHeld(body.data);
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
      setHeld(hydrate(draftId));
    }
    if (myTeamId === null) {
      setHeld(null);
      setError(null);
      forgetAdvisor(draftId);
      return;
    }
    recompute();
  }, [draftId, sequence, myTeamId, recompute]);

  const view = useMemo(() => (held === null ? null : presentView(held, availablePlayerIds)), [held, availablePlayerIds]);
  const stale = held !== null && held.stamp.sequence < sequence;
  return { view, recomputing: inFlight || stale, error };
}
