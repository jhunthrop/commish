"use client";

import { useMemo } from "react";
import type { Player } from "@/domain/player";
import { Button, PositionBadge } from "@/components/ui";
import { useCountdown } from "@/components/ui/countdown";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { QUILT_CONFIG } from "../state/config";
import type { PendingPick } from "../state/pending-pick";

export interface UndoPillProps {
  readonly pending: PendingPick;
  readonly player: Player | null;
  /** The player this window replaced (`PendingPick.swappedFromPlayerId`, resolved), or null.
   *  When set, the pill's sub-line announces the swap for the remainder of the window — the
   *  last-word-wins gesture is fast on purpose, and this line is what keeps it from being
   *  silent. */
  readonly swappedFrom: Player | null;
  readonly onUndo: () => void;
}

const RING_RADIUS = 14;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * PICK SAFETY, the visible half (`PickMoment` mock, beat 3): the pick sits here, locking in,
 * until the radial countdown runs out — and only then does it leave this browser. UNDO is the
 * one red-adjacent verb in the room, worded and bounded so a slipped finger costs nothing.
 * Reduced motion swaps the draining ring for the same number as plain text.
 */
export function UndoPill({ pending, player, swappedFrom, onUndo }: UndoPillProps) {
  const commitsAtIso = useMemo(() => new Date(pending.commitsAt).toISOString(), [pending.commitsAt]);
  const { remainingMs } = useCountdown(commitsAtIso);
  const reducedMotion = usePrefersReducedMotion();
  const remaining = remainingMs ?? QUILT_CONFIG.undoWindowMs;
  const seconds = Math.max(1, Math.ceil(remaining / 1_000));
  const fraction = Math.max(0, Math.min(1, remaining / QUILT_CONFIG.undoWindowMs));

  return (
    <div
      data-testid="undo-pill"
      role="status"
      className="pointer-events-auto flex items-center gap-3 rounded-md border border-accent bg-surface-raised px-4 py-2 shadow-card"
    >
      {player === null ? null : <PositionBadge position={player.position} size="sm" />}
      <div className="flex flex-col">
        <span className="font-display text-md font-semibold text-text-primary">{player?.name ?? "Your pick"}</span>
        <span className="text-xs text-text-faint">{swappedFrom === null ? "locking in…" : `swapped from ${swappedFrom.name}`}</span>
      </div>
      {reducedMotion ? (
        <span className="font-display text-sm font-bold text-accent tabular-nums">{seconds}s</span>
      ) : (
        <span className="relative inline-flex h-9 w-9 items-center justify-center" aria-hidden="true">
          <svg width="36" height="36" viewBox="0 0 36 36" className="absolute inset-0">
            <circle cx="18" cy="18" r={RING_RADIUS} fill="none" strokeWidth="3" className="stroke-line" />
            <circle
              cx="18"
              cy="18"
              r={RING_RADIUS}
              fill="none"
              strokeWidth="3"
              strokeDasharray={RING_CIRCUMFERENCE}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - fraction)}
              transform="rotate(-90 18 18)"
              className="stroke-accent"
            />
          </svg>
          <span className="font-display text-sm font-bold text-accent tabular-nums">{seconds}</span>
        </span>
      )}
      <Button size="sm" variant="destructive" onClick={onUndo}>
        Undo
      </Button>
    </div>
  );
}
