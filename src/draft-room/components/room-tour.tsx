"use client";

import { useState } from "react";
import { Button, Modal } from "@/components/ui";

export interface RoomTourProps {
  /** From the server-read preference row. `null` means the tour has never been dismissed. */
  readonly dismissedAt: string | null;
  /**
   * Called once, when the manager clicks "Got it" (or presses Esc). The tour closes
   * immediately regardless of what this does — see the component docblock.
   */
  readonly onDismiss: () => void;
  /**
   * The real button `PlayerPool` renders for this room — "Draft" for snake, "Nominate" for
   * auction (`actionLabelFor`, `../lib/lookups.ts`). `RoomTour` mounts unconditionally for both
   * formats (`DraftRoom`), so the one stop that names a button has to say the ACTUAL word this
   * room uses, not a word that is only sometimes true.
   */
  readonly actionLabel: string;
}

interface TourStop {
  readonly heading: string;
  readonly body: string;
}

/**
 * Fixed content plus the one stop whose body depends on `actionLabel` — kept as a function
 * rather than a second static table, so there is exactly one list of stops regardless of format.
 */
function tourStops(actionLabel: string): readonly TourStop[] {
  return [
    { heading: "The clock", body: "Counts down the team currently on the clock. When it reaches zero, an autopick fills the slot so the draft never stalls." },
    { heading: "The queue", body: "Your own list of players, in order. Set it once and the room drafts down it automatically whenever your pick is autopicked." },
    {
      heading: "Taking your turn",
      body: `When it's your turn, click ${actionLabel} next to the player you want. Do it before the clock runs out, or an autopick chooses for you.`,
    },
  ];
}

/**
 * Shown once, the first time a manager opens a draft room, and never again. `dismissedAt` is
 * server-read state (`readPreferences`, passed down through `DraftRoomPage` -> `DraftRoom`), so
 * a manager who dismisses it on one device does not see it again on another.
 *
 * Dismissal is fire-and-forget by design: `onDismiss` PATCHes `/api/preferences` from the
 * caller, but this component closes on click regardless of whether that call ever resolves, and
 * swallows a SYNCHRONOUS throw from `onDismiss` too. A failed preference write is never allowed
 * to be the thing standing between a manager and a live draft — the worst case is seeing this
 * tour again next time.
 */
export function RoomTour({ dismissedAt, onDismiss, actionLabel }: RoomTourProps) {
  // Local, not derived solely from `dismissedAt`: the write that would update that prop is
  // best-effort and may never land (or may land after this component has already unmounted),
  // so closing has to be something this component can do to itself.
  const [dismissedLocally, setDismissedLocally] = useState(false);
  const open = dismissedAt === null && !dismissedLocally;

  const dismiss = (): void => {
    try {
      onDismiss();
    } catch {
      // Best-effort: see the component docblock. The tour still closes, below.
    } finally {
      setDismissedLocally(true);
    }
  };

  return (
    <Modal open={open} title="How this room works" onClose={dismiss} footer={<Button onClick={dismiss}>Got it</Button>}>
      <div className="flex flex-col gap-3">
        {tourStops(actionLabel).map((stop) => (
          <div key={stop.heading}>
            <h3 className="font-semibold text-text-primary">{stop.heading}</h3>
            <p className="text-sm text-text-muted">{stop.body}</p>
          </div>
        ))}
      </div>
    </Modal>
  );
}
