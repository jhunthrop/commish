"use client";

import type { RoomNudge } from "../hooks/use-draft-room";

export interface NudgeBannerProps {
  readonly nudge: RoomNudge | null;
  /** The view's current sequence. The banner is for THIS turn only. */
  readonly sequence: number;
}

/**
 * The AI draft moderator speaking in the room. Rendered only while the nudge still describes
 * the turn in progress, so it clears itself the instant the turn moves on — no timer, no
 * cleanup, nothing to leak. `role="status"` + polite: a manager on a clock should hear it
 * once, and should not have it re-announced by a toast as well.
 */
export function NudgeBanner({ nudge, sequence }: NudgeBannerProps) {
  if (nudge === null || nudge.sequence !== sequence) return null;
  return (
    <p role="status" aria-live="polite" className="rounded-md border border-warning bg-surface-elevated px-3 py-2 text-text-primary">
      {nudge.message}
    </p>
  );
}
