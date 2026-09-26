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

/**
 * The room as the advisor reads it (the batched bots round, 2026-09-25): which draft, the log
 * sequence the server holds (`sequence`, the committed view's, what the advisor is computed
 * against), the sequence the room has REVEALED so far, the next instant a committed pick is
 * revealed (this browser's clock; null when nothing waits), and every player still on the
 * revealed board.
 */
export interface AdvisorRoom {
  readonly draftId: string;
  readonly sequence: number;
  readonly revealedSequence: number;
  readonly nextRevealAtMs: number | null;
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
 * room's committed log sequence, which every pick event (and every other applied action) moves.
 * `myTeamId === null` never fetches: a commissioner has no seat to advise.
 *
 * COALESCED, NEVER PILED UP (simplification round): the request carries no state of its own,
 * the server always answers from the room's CURRENT state, so a pick event that lands while a
 * request is in flight only marks the hook dirty, and exactly one more request follows when the
 * current one lands. The lag the founder measured was requests queued behind each other on the
 * server, one per pick event, each computing a state nobody would see.
 *
 * ASKED AT THE FIRST REVEAL, SHOWN AT THE LAST (the batched bots round). A batch of bot picks
 * commits at once and reveals one by one; the server's facts for the post-batch state are
 * computed by the pick's own invocation right after it answers, and the first bot's reveal is
 * at least one seeded delay later, so the fetch waits for that instant (`nextRevealAtMs`) and
 * reads what was written instead of racing the writer. Its answer is about the state the human
 * will face when the last bot is revealed, so it is STAGED until the room's revealed sequence
 * reaches its stamp, then shown: her dock is ready the moment her turn is, and no odds about a
 * pick still hidden ever show while it is hidden. With nothing waiting the fetch is immediate.
 */
export function useAdvisor(room: AdvisorRoom, myTeamId: string | null): UseAdvisorResult {
  const { draftId, sequence, revealedSequence, nextRevealAtMs, availablePlayerIds } = room;
  const deps = useDraftRoomDeps();
  const [held, setHeld] = useState<AdvisorView | null>(() => hydrate(draftId));
  const [staged, setStaged] = useState<AdvisorView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftIdRef = useRef<string>(draftId);
  const aliveRef = useRef(true);
  const inFlightRef = useRef(false);
  const dirtyRef = useRef(false);
  const revealedSequenceRef = useRef(revealedSequence);
  revealedSequenceRef.current = revealedSequence;
  const nextRevealAtRef = useRef(nextRevealAtMs);
  nextRevealAtRef.current = nextRevealAtMs;

  const fetchOnce = useCallback(async (): Promise<void> => {
    try {
      const response = await deps.fetchJson(`/api/drafts/${draftId}/assistant`);
      const body = (await response.json()) as ApiEnvelope<AdvisorView>;
      if (!aliveRef.current) return;
      if (!body.ok) {
        setError(body.error);
        return;
      }
      setError(null);
      if (body.data.stamp.sequence <= revealedSequenceRef.current) {
        setStaged(null);
        setHeld(body.data);
        rememberAdvisor(draftId, { lastView: body.data });
      } else {
        setStaged(body.data);
      }
    } catch {
      if (aliveRef.current) setError(NETWORK_ERROR);
    }
  }, [deps, draftId]);

  // NO `inFlight` STATE (fluidity round, 2026-09-10): the hook used to flip a state flag on and
  // off around every request, and each flip re-rendered the whole room — one pick was four
  // whole-tree commits (the pick, flag on, the view, flag off), 120 to 170 ms apart. Whether a
  // fresh view is on its way is already a fact of the data: the held stamp trails the room's
  // sequence, or nothing has been held yet. `recomputing` below is derived from that, and a
  // request in flight moves nothing but the ref that coalesces it.
  const recompute = useCallback((): void => {
    if (inFlightRef.current) {
      dirtyRef.current = true;
      return;
    }
    inFlightRef.current = true;
    void (async () => {
      do {
        dirtyRef.current = false;
        await fetchOnce();
      } while (aliveRef.current && dirtyRef.current);
      inFlightRef.current = false;
    })();
  }, [fetchOnce]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // The fetch, once per committed sequence, at the first reveal it is waiting on (or now).
  useEffect(() => {
    if (draftIdRef.current !== draftId) {
      forgetAdvisor(draftIdRef.current);
      draftIdRef.current = draftId;
      setHeld(hydrate(draftId));
      setStaged(null);
    }
    if (myTeamId === null) {
      setHeld(null);
      setStaged(null);
      setError(null);
      forgetAdvisor(draftId);
      return;
    }
    const at = nextRevealAtRef.current;
    const delay = at === null ? 0 : Math.max(0, at - Date.now());
    const timer = setTimeout(recompute, delay);
    return () => clearTimeout(timer);
  }, [draftId, sequence, myTeamId, recompute]);

  // The promotion: a staged answer is shown once the room has revealed the state it is about.
  useEffect(() => {
    if (staged === null || staged.stamp.sequence > revealedSequence) return;
    setHeld(staged);
    setStaged(null);
    rememberAdvisor(draftId, { lastView: staged });
  }, [staged, revealedSequence, draftId]);

  const view = useMemo(() => (held === null ? null : presentView(held, availablePlayerIds)), [held, availablePlayerIds]);
  // Recomputing: a seated caller whose held view trails the revealed room, or who holds nothing
  // yet and has not been refused. Derived, so it changes exactly when the view or the room does.
  const recomputing = myTeamId !== null && (held === null ? error === null : held.stamp.sequence < revealedSequence);
  // One object per distinct answer: every drawer tab and every pool row takes this as a prop.
  return useMemo(() => ({ view, recomputing, error }), [view, recomputing, error]);
}
