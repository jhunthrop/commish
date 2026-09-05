"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiEnvelope } from "@/lib/api/respond";
import type { AssistantCallView } from "@/draft-service/assistant/call";
import { useDraftRoomDeps } from "../hooks/deps";
import { forgetAssistant, recallAssistant, rememberAssistant } from "./assistant-memory";

export interface UseAssistantResult {
  readonly call: AssistantCallView | null;
  /**
   * THE POST-PICK BEAT'S OWN CAPTURE — Task 7. The call that was live during THIS seat's most
   * recently resolved turn, latched the instant a fetch lands whose immediately-prior call had
   * `onTheClock === true` — only the seat on the clock for a given pick number can be the one who
   * resolves it, so that condition can only be true right after THIS seat's own pick. Unlike
   * `call`, this is NOT overwritten by every subsequent refetch: it survives every other seat's
   * picks in between, AND it survives this seat's own next turn arriving — the contract is "until
   * the next call loads or your next pick," i.e. until your next pick LANDS, not merely until your
   * next turn starts. So in a SOLO mock room, where sim-to-next-pick can put you back on the clock
   * within the very same pick's refetch stretch, the beat stays visible while you sit on the clock
   * deciding — exactly when it is most useful. It is REPLACED (not cleared) the instant a fetch
   * lands whose immediately-prior call also had `onTheClock === true` (your next pick just
   * resolved) — the new pre-pick capture supersedes the old one. It clears to null only when this
   * seat loses its seat (`myTeamId === null`) or when the draft changes out from under the hook.
   * Null until this seat's first pick of the current draft has ever landed.
   *
   * SURVIVES THE TAB UNMOUNT A PICK REQUIRES: submitting your own pick means switching to the
   * Pool tab, which unmounts this hook's own component (`DrawerAssistantTab` — the quilt gates
   * the fetch to that tab being mounted, a deliberate cost bound this fix does not relax). A plain
   * `useState`/`useRef` latch would be destroyed by that unmount and lost before you ever switched
   * back to see it. `assistant-memory.ts`'s module-scope map is what survives it — this hook
   * hydrates from it on mount and writes through on every update (see that module's own docblock
   * for the full account of why module scope over a Context).
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
  // Hydrated from `assistant-memory.ts` rather than plain `null` — a remount after the Pool-tab
  // round trip a pick requires must pick up the prior instance's latch, not start over blind.
  const remembered = recallAssistant(draftId);
  const [call, setCall] = useState<AssistantCallView | null>(remembered?.lastCall ?? null);
  const [prePickCall, setPrePickCall] = useState<AssistantCallView | null>(remembered?.prePickCall ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Mirrors `call` for the fetch closure below — reading `call` there would rebuild the effect
  // on every response and refetch is keyed on `pickNumber` alone.
  const callRef = useRef<AssistantCallView | null>(remembered?.lastCall ?? null);
  // Mirrors `prePickCall` the same way, so the write-through into memory always has both halves
  // of the record without depending on a `setState` having already flushed.
  const prePickCallRef = useRef<AssistantCallView | null>(remembered?.prePickCall ?? null);
  // Tracks which draft this hook's state belongs to, so a `draftId` change (a different room
  // entirely, not just a new pick in the same one) rehydrates from THAT draft's own memory rather
  // than carrying a stale call from one draft into the next.
  const draftIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (draftIdRef.current !== draftId) {
      const previousDraftId = draftIdRef.current;
      draftIdRef.current = draftId;
      // The draft this hook was just looking at is behind it now — its own entry has no further
      // reader (a real re-visit fetches fresh rather than trusting a possibly stale memory).
      if (previousDraftId !== null) forgetAssistant(previousDraftId);
      const hydrated = recallAssistant(draftId);
      callRef.current = hydrated?.lastCall ?? null;
      prePickCallRef.current = hydrated?.prePickCall ?? null;
      setCall(callRef.current);
      setPrePickCall(prePickCallRef.current);
    }

    if (myTeamId === null) {
      callRef.current = null;
      prePickCallRef.current = null;
      setCall(null);
      setPrePickCall(null);
      setLoading(false);
      setError(null);
      forgetAssistant(draftId);
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
          // This seat's own pick just resolved — replace any latched beat with the call it was
          // looking at, and let it survive every refetch that follows, including this seat's own
          // next turn arriving, until the next pick resolves.
          prePickCallRef.current = previous;
          setPrePickCall(previous);
        }

        callRef.current = body.data;
        setCall(body.data);
        setError(null);
        setLoading(false);
        // Write through so a remount (the Pool-tab round trip a pick requires) inherits exactly
        // this state rather than starting blind.
        rememberAssistant(draftId, { lastCall: callRef.current, prePickCall: prePickCallRef.current });
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
