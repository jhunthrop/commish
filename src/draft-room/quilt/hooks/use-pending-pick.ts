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
 * exactly like tapping UNDO and then DRAFT by hand.
 *
 * `submit` is the room's own act (`onAct` → `room.submit`); this hook never talks to the
 * network itself, so the optimistic view, rollback and rejection toasts all keep working
 * unchanged the moment the window closes.
 */
export function usePendingPick(submit: (playerId: string) => void, deadlineAt: string | null): PendingPickControls {
  const [pending, setPending] = useState<PendingPick | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The submit callback a timer will fire lives in a ref so an in-flight window never captures
  // a stale closure — the same idiom `useDraftRoom`'s own viewRef keeps.
  const submitRef = useRef(submit);
  submitRef.current = submit;

  const clearTimer = (): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const begin = useCallback(
    (playerId: string): void => {
      clearTimer();
      const held = beginPendingPick(playerId, Date.now(), deadlineAt);
      setPending(held);
      if (held === null) {
        submitRef.current(playerId);
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setPending(null);
        submitRef.current(playerId);
      }, held.commitsAt - Date.now());
    },
    [deadlineAt],
  );

  const undo = useCallback((): void => {
    clearTimer();
    setPending(null);
  }, []);

  // Unmount abandons the window WITHOUT submitting: navigating away mid-pill is an undo, never
  // a silent pick fired from a room the manager has already left.
  useEffect(() => clearTimer, []);

  return { pending, begin, undo };
}
