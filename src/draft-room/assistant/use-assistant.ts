"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { AssistantCallView } from "@/draft-service/assistant/call";
import { useDraftRoomDeps } from "../hooks/deps";

export interface UseAssistantResult {
  readonly call: AssistantCallView | null;
  /**
   * THE POST-PICK BEAT'S OWN CAPTURE — Task 7. The call that was live during THIS seat's most
   * recently resolved turn, latched the instant a fetch lands whose immediately-prior call had
   * `onTheClock === true` — only the seat on the clock for a given pick number can be the one who
   * resolves it, so that condition can only be true right after THIS seat's own pick. Unlike
   * `call`, this is NOT overwritten by every subsequent refetch: it survives every other seat's
   * picks in between, so the beat stays available through a full waiting turn, not just until the
   * very next pick anywhere in the draft. It clears (back to null) the moment a call arrives with
   * `onTheClock === true` again (this seat's NEXT turn has arrived, so the old beat is stale), when
   * this seat loses its seat (`myTeamId === null`), or when the draft changes out from under the
   * hook. Null until this seat's first pick of the current draft has ever landed.
   */
  readonly prePickCall: AssistantCallView | null;
  readonly loading: boolean;
  /** The server's own honest word for why there is no call right now (409's message, or a
   *  network failure) — never fabricated copy. Cleared on the next successful fetch. */
  readonly error: string | null;
}

const NETWORK_ERROR = "We couldn't reach the assistant. Check your connection and try again.";

/**
 * THE CALL'S OWN FETCH — Task 6. One `GET /api/drafts/:draftId/assistant` per `pickNumber`
 * change (the SSE fold already advances it on every pick anywhere in the draft, not just your
 * own), through the room's shared `fetchJson` dep. Mock rooms ride the identical route
 * (`assistantCall`'s own state-load seam covers both), so this hook needs no mock-only branch.
 *
 * `myTeamId === null` (a commissioner or a stranger) has nothing to be advised about —
 * `assistantCall` would answer 409 every single time — so this hook never even fetches for that
 * case rather than paying for a call whose answer is already known.
 *
 * NO SPINNER FLASH: a refetch never clears `call` first. `loading` flips true for a caller that
 * wants to know, but the PREVIOUS call keeps rendering until the new one lands (or the request
 * fails) — a mid-room refetch is a quiet background update, not a screen wipe.
 */
export function useAssistant(draftId: string, pickNumber: number, myTeamId: string | null): UseAssistantResult {
  const deps = useDraftRoomDeps();
  const [call, setCall] = useState<AssistantCallView | null>(null);
  const [prePickCall, setPrePickCall] = useState<AssistantCallView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mirrors `call` for the fetch closure below — reading `call` there would rebuild the effect
  // on every response and refetch is keyed on `pickNumber` alone.
  const callRef = useRef<AssistantCallView | null>(null);
  // Tracks which draft this hook's state belongs to, so a `draftId` change (a different room
  // entirely, not just a new pick in the same one) resets the latch rather than carrying a stale
  // call from one draft into the next.
  const draftIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (draftIdRef.current !== draftId) {
      draftIdRef.current = draftId;
      callRef.current = null;
      setCall(null);
      setPrePickCall(null);
    }

    if (myTeamId === null) {
      callRef.current = null;
      setCall(null);
      setPrePickCall(null);
      setLoading(false);
      setError(null);
      return;
    }

    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const response = await deps.fetchJson(`/api/drafts/${draftId}/assistant`);
        const body = (await response.json()) as ApiEnvelope<AssistantCallView>;
        if (!alive) return;
        if (!body.ok) {
          setError(body.error);
          setLoading(false);
          return;
        }

        const previous = callRef.current;
        if (previous !== null && previous.onTheClock) {
          // This seat's own pick just resolved — latch the call it was looking at, and let it
          // survive every refetch that follows until this seat is back on the clock.
          setPrePickCall(previous);
        } else if (body.data.onTheClock) {
          // This seat's NEXT turn has arrived — any beat about the pick before that is stale.
          setPrePickCall(null);
        }

        callRef.current = body.data;
        setCall(body.data);
        setError(null);
        setLoading(false);
      } catch {
        if (alive) {
          setError(NETWORK_ERROR);
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [deps, draftId, pickNumber, myTeamId]);

  return { call, prePickCall, loading, error };
}
