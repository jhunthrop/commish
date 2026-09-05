"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { AssistantCallView } from "@/draft-service/assistant/call";
import { useDraftRoomDeps } from "../hooks/deps";

export interface UseAssistantResult {
  readonly call: AssistantCallView | null;
  /**
   * The call that was live just before the most recent successful fetch replaced it — Task 7's
   * post-pick beat reads this as "the call captured at your pick": once your own pick lands,
   * `pickNumber` advances, this hook refetches, and whatever `call` held right before that
   * refetch landed here. Null until a second call has ever loaded (the draft's first turn, or a
   * commissioner who just gained a seat — neither has a "before" to report).
   */
  readonly previousCall: AssistantCallView | null;
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
  const [previousCall, setPreviousCall] = useState<AssistantCallView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mirrors `call` for the fetch closure below — reading `call` there would rebuild the effect
  // on every response and refetch is keyed on `pickNumber` alone.
  const callRef = useRef<AssistantCallView | null>(null);

  useEffect(() => {
    if (myTeamId === null) {
      callRef.current = null;
      setCall(null);
      setPreviousCall(null);
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
        setPreviousCall(callRef.current);
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

  return { call, previousCall, loading, error };
}
