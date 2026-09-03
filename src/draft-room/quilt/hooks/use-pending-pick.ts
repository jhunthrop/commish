"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { beginPendingPick, type PendingPick } from "../state/pending-pick";

export interface PendingPickControls {
  /** The pick sitting in its undo window, or null. */
  readonly pending: PendingPick | null;
  /** Confirm a pick: starts the window, or submits immediately under the squeeze rule. */
  readonly begin: (playerId: string) => void;
  /** The UNDO verb. A no-op once the window has expired — the submit has already left. */
  readonly undo: () => void;
}

/**
 * The undo window's clockwork: `begin` either submits at once (squeeze rule — see
 * `undoWindowMs`) or holds the pick locally and submits when the window closes. Beginning a
 * second pick while one pends is an undo of the first plus a fresh window — the last word wins,
 * exactly like tapping UNDO and then DRAFT by hand — and the fresh window remembers what it
 * replaced (`PendingPick.swappedFromPlayerId`) so the pill can say so.
 *
 * A TAPPED DRAFT IS AN AFFIRMATIVE CHOICE (whole-branch review, HIGH — overruling this hook's
 * first contract). The window protects against slipped fingers, never against navigation, so a
 * held pick is never silently dropped:
 *
 * - Unmount with a pick pending FLUSHES it — the submit fires from the cleanup, immediately.
 * - While a pick pends, a `beforeunload` handler asks the browser for its native leave prompt,
 *   and `pagehide` flushes the pick before the page goes (the actions POST rides
 *   `keepalive: true` — see `useDraftRoom.submit` — so a flush started on the way out can
 *   still be delivered).
 *
 * The only gestures that discard a held pick are the ones that SAY so: UNDO, and beginning a
 * different pick.
 *
 * `submit` is the room's own act path; this hook never talks to the network itself, so the
 * optimistic view, rollback and rejection messaging keep working unchanged whenever the window
 * closes.
 */
export function usePendingPick(submit: (playerId: string) => void, deadlineAt: string | null): PendingPickControls {
  const [pending, setPending] = useState<PendingPick | null>(null);
  // Long-lived handlers (the expiry timer, pagehide, the unmount cleanup) read these refs so
  // none of them ever closes over a stale pick or a stale submit — `useDraftRoom`'s own idiom.
  const pendingRef = useRef<PendingPick | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const clearTimer = (): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const hold = (held: PendingPick | null): void => {
    pendingRef.current = held;
    setPending(held);
  };

  /** Close the window early and submit what it holds. A no-op with nothing pending. */
  const flush = useCallback((): void => {
    const held = pendingRef.current;
    if (held === null) return;
    clearTimer();
    hold(null);
    submitRef.current(held.playerId);
  }, []);

  const begin = useCallback(
    (playerId: string): void => {
      clearTimer();
      const previous = pendingRef.current;
      const swappedFrom = previous !== null && previous.playerId !== playerId ? previous.playerId : null;
      const held = beginPendingPick(playerId, Date.now(), deadlineAt, swappedFrom);
      hold(held);
      if (held === null) {
        submitRef.current(playerId);
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        hold(null);
        submitRef.current(playerId);
      }, held.commitsAt - Date.now());
    },
    [deadlineAt],
  );

  const undo = useCallback((): void => {
    clearTimer();
    hold(null);
  }, []);

  // The leave guards, mounted only while a pick actually pends: the native confirm prompt on a
  // tab close, and a flush when the page truly goes.
  useEffect(() => {
    if (pending === null) return;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      // Chrome still requires a set returnValue for the prompt to appear.
      event.returnValue = "";
    };
    const onPageHide = (): void => flush();
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [pending, flush]);

  // Unmount FLUSHES — see the docblock. Reads the refs directly so the empty dependency list is
  // honest: the cleanup submits whatever is genuinely held at unmount time.
  useEffect(
    () => () => {
      const held = pendingRef.current;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      if (held !== null) {
        pendingRef.current = null;
        submitRef.current(held.playerId);
      }
    },
    [],
  );

  return { pending, begin, undo };
}
