"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftStateView } from "@/draft-engine";
import { DRAFT_ROOM_CONFIG } from "../state/config";

/**
 * The finale's stages, in the order they happen. Mocks walk
 * `idle → moment → refetching → (preparing → manual)`; real leagues walk
 * `idle → moment → panel → dismissed`. Nothing ever walks backwards except the manual
 * button, which re-enters `refetching` for one more bounded cycle.
 */
export type FinaleStage =
  | "idle"
  | "moment"
  | "refetching"
  | "preparing"
  | "manual"
  | "panel"
  | "dismissed";

export interface DraftFinaleArgs {
  /** The room's own current phase — `null` while the snapshot is still loading. */
  readonly phase: DraftStateView["phase"] | null;
  /** Whether this room is a practice room (`room.mock !== null`). */
  readonly isMock: boolean;
  /** Whether the snapshot already carries the debrief (`room.mock?.results != null`). */
  readonly hasResults: boolean;
  /** `useDraftRoom.refresh` — the room's own GET, single-flighted by the hook itself. */
  readonly refresh: () => Promise<void>;
}

export interface DraftFinale {
  readonly stage: FinaleStage;
  /** The real-draft panel's quiet way out — back to the completed, browsable board. */
  readonly dismiss: () => void;
  /** The manual "See your debrief" fallback: one more bounded refetch cycle, never a loop. */
  readonly seeDebrief: () => void;
}

/**
 * THE TRANSITION DETECTOR AND STAGE MACHINE (the draft finale, 2026-09-04 —
 * `docs/superpowers/specs/2026-09-04-draft-finale-design.md`).
 *
 * Fires on the TRANSITION `in_progress → complete` witnessed in client state, never on the
 * state itself: the previous phase lives in a ref, so a page that loads an already-complete
 * draft (previous phase `null`) never fires and renders exactly what it renders today — the
 * debrief for a settled mock, the completed board for a real league, no fanfare. The flip's
 * carrier doesn't matter (an SSE frame's clock, a resync refetch): the room's own view is the
 * one authority watched.
 *
 * After the beat (`momentMs`), a mock room re-fetches its own GET until the payload carries
 * `mock.results` — bounded (`resultsRetryCount` attempts, `resultsRetryMs` apart), one quiet
 * cycle and one behind the "Preparing your debrief" line, then a manual button. A real league
 * goes straight to the completion panel. Pick machinery, the engine and the SSE plumbing are
 * untouched: this hook reads `phase` and calls the existing `refresh`, nothing else.
 */
export function useDraftFinale({ phase, isMock, hasResults, refresh }: DraftFinaleArgs): DraftFinale {
  const [stage, setStage] = useState<FinaleStage>("idle");
  const [attempt, setAttempt] = useState(0);
  const previousPhaseRef = useRef<DraftStateView["phase"] | null>(null);

  // The detector. A ref, not state: the previous phase is a fact about the render that
  // already happened, and writing it must never itself cause one.
  useEffect(() => {
    const previous = previousPhaseRef.current;
    previousPhaseRef.current = phase;
    if (previous === "in_progress" && phase === "complete") setStage("moment");
  }, [phase]);

  // The beat. One timer, cleaned up on unmount; where it hands off is decided by what kind
  // of room this is, not by anything that could change mid-beat.
  useEffect(() => {
    if (stage !== "moment") return;
    const timer = setTimeout(() => setStage(isMock ? "refetching" : "panel"), DRAFT_ROOM_CONFIG.finale.momentMs);
    return () => clearTimeout(timer);
  }, [stage, isMock]);

  // The mock refetch cycles. `hasResults` flipping true ends the whole story — the parent's
  // existing `room.mock?.results` branch renders the debrief, and this effect simply stops
  // driving. Each pass schedules at most ONE timer: the attempt counter is what walks the
  // cycle forward, and exhausting it advances the stage instead of scheduling anything.
  useEffect(() => {
    if (stage !== "refetching" && stage !== "preparing") return;
    if (hasResults) return;
    if (attempt >= DRAFT_ROOM_CONFIG.finale.resultsRetryCount) {
      setStage(stage === "refetching" ? "preparing" : "manual");
      setAttempt(0);
      return;
    }
    const delay = attempt === 0 ? 0 : DRAFT_ROOM_CONFIG.finale.resultsRetryMs;
    const timer = setTimeout(() => {
      void refresh().finally(() => setAttempt((count) => count + 1));
    }, delay);
    return () => clearTimeout(timer);
  }, [stage, hasResults, attempt, refresh]);

  const dismiss = useCallback(() => setStage("dismissed"), []);
  const seeDebrief = useCallback(() => {
    setAttempt(0);
    setStage("refetching");
  }, []);

  return { stage, dismiss, seeDebrief };
}
