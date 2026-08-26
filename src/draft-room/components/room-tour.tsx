"use client";

import { useLayoutEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { usePrefersReducedMotion } from "@/design/use-reduced-motion";
import { CoachMarks, type CoachMarkStop } from "./coach-marks";

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
 * The closing stop's own sentence (Task 9, Step 1) — two phrases, neither invented here. The
 * first is C3's own safety-net phrase, verbatim, the ONE sanctioned way this product reassures
 * anyone about missing a draft (`docs/design-system.md`'s "Copy" section, `copy-rules.ts`'s
 * `FORBIDDEN_VOCABULARY` family). The second is `MOCK_COPY.lobbyEmptyActionLabel`'s own words
 * (`@/mock-draft/config`) — copied rather than imported:
 * `src/draft-room/**` may not value-import `@/mock-draft` (the client boundary), the identical
 * reason `PracticeBanner`/`MockResults` receive that module's words as PROPS rather than a live
 * import. This stop needs no prop plumbing because it says the same thing in every room,
 * mock or real, unlike those two: `src/integrity/rendered-copy.test.tsx` renders this component
 * and compares its literal text against `MOCK_CONFIG`'s real value directly, the same drift-proof
 * pattern that file already keeps for `TradeCard`'s held-trade sentence.
 */
const CLOSING_STOP: TourStop = {
  heading: "Practice anytime",
  body: "Even if you miss your pick, the room picks for you from your queue. Start a mock draft anytime to practice first.",
};

/**
 * Fixed content plus the one stop whose body depends on `actionLabel` — kept as a function
 * rather than a second static table, so there is exactly one list of stops regardless of format.
 *
 * Task 9's own sweep (`src/integrity/rendered-copy.test.tsx`, RoomTour's first-ever rendered
 * sweep) caught a REAL pre-existing gap here: `src/draft-room` sits outside
 * `room-copy.source.test.ts`'s own `ROOM_DIRS`, so these three stops had said "an autopick..."
 * (C3's own banned vocabulary) and a contraction ("it's") since before this task, unswept by
 * anything. Fixed in the same commit that added the sweep that found it — every mention of the
 * safety net below now quotes C3's own sanctioned phrase, verbatim, the identical string the
 * closing stop quotes.
 */
function tourStops(actionLabel: string): readonly TourStop[] {
  return [
    {
      heading: "The clock",
      body: "Counts down whoever is on the clock, including you. When it reaches zero, the room picks for you from your queue so the draft never stalls.",
    },
    { heading: "The queue", body: "Your own list of players, in order. The room picks for you from your queue whenever you miss your turn." },
    {
      heading: "Taking your turn",
      body: `When it is your turn, click ${actionLabel} next to the player you want. Do it before the clock runs out, or the room picks for you from your queue.`,
    },
    CLOSING_STOP,
  ];
}

/**
 * The three real controls the first three stops point at, in the SAME order `tourStops` returns
 * them — the closing stop has no target (it centers) and so has no entry here, which is why
 * `anchoredStops` below falls back to `null` past the end of this list rather than requiring a
 * fourth entry. Stable, plain DOM ids (not `data-testid`, which this codebase reserves for
 * tests) added at Task 4 to `room-rail.tsx` (the clock band), `room-dock.tsx` (the queue,
 * present in both its empty and populated shapes) and `player-pool.tsx` (already carried
 * `id="player-pool"` from Task 3's "jump to the pool" affordance, reused rather than duplicated).
 */
const ANCHOR_TARGET_IDS: readonly string[] = ["room-clock", "dock-queue", "player-pool"];

/** `tourStops`'s own four stops, each paired with the target it anchors to (`null` for the
 *  closing stop) — the one list `CoachMarks` renders, built without touching `tourStops`'s own
 *  pinned copy in any way. */
function anchoredStops(actionLabel: string): readonly CoachMarkStop[] {
  return tourStops(actionLabel).map((stop, index) => ({ ...stop, targetId: ANCHOR_TARGET_IDS[index] ?? null }));
}

/**
 * Whether every real anchor target is in the DOM right now — read only while `active` (the tour
 * is actually open), and only from an effect: this is a `document.getElementById` read, which
 * during a render pass would run before React commits anything (the exact trap `CoachMarks`'
 * own docblock names), and would disagree with the server render either way. Starts `false` —
 * the same safe-default-then-upgrade shape `usePrefersReducedMotion` uses — so a room that never
 * gets a chance to run the effect (or fails every target) simply keeps the modal, never leaves
 * the tour showing nothing at all.
 */
function useAnchorsReady(active: boolean): boolean {
  const [ready, setReady] = useState(false);

  // `useLayoutEffect`, not `useEffect`: this runs synchronously right after the SAME commit
  // that first mounts `RoomTour` alongside `RoomRail`/`RoomDock`/`PlayerPool` (they are siblings
  // in `DraftRoom`'s own return, so their DOM lands in one commit together) and before the
  // browser paints — a plain `useEffect` here left a real, observable frame where this component
  // had already rendered its (stale, default-`false`) modal fallback before flipping to
  // anchored, which is both a visible flash in the room and a race any `waitFor` polling for a
  // dialog could catch mid-flip.
  useLayoutEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    setReady(ANCHOR_TARGET_IDS.every((id) => document.getElementById(id) !== null));
  }, [active]);

  return ready;
}

/**
 * Two callers, two modes, same component — `open` is always exactly `dismissedAt === null &&
 * !dismissedLocally`, and each caller shapes the props that flow into it differently.
 *
 * **The draft room's own auto-onboarding (its original caller).** Shown once, the first time a
 * manager opens a draft room, and never again. `dismissedAt` is server-read state
 * (`readPreferences`, passed down through `DraftRoomPage` -> `DraftRoom`), so a manager who
 * dismisses it on one device does not see it again on another. Dismissal is fire-and-forget by
 * design: `onDismiss` PATCHes `/api/preferences` from the caller, but this component closes on
 * click regardless of whether that call ever resolves, and swallows a SYNCHRONOUS throw from
 * `onDismiss` too. A failed preference write is never allowed to be the thing standing between a
 * manager and a live draft — the worst case is seeing this tour again next time.
 *
 * **The waiting room's own repeatable preview (Phase 3.6, Task 9)** — `WaitingChecklist`'s "See
 * how the draft room works" item mounts this with `dismissedAt` HARDCODED `null` and no
 * `/api/preferences` write at all: `onDismiss` just unmounts it (a local `showTour` flip in the
 * caller). It opens every time the caller mounts it, by construction, and is never itself the
 * "have you seen this" gate — that gate belongs entirely to the draft room's own caller above.
 *
 * **Anchored by default, modal as the fallback (Task 4, R3).** Neither caller changed a prop —
 * `RoomTour` decides its OWN presentation from what is actually on screen. It renders
 * `CoachMarks`, pointing one popover at a time at the real clock/queue/pool, whenever BOTH: (1)
 * `usePrefersReducedMotion()` is false (a moving popover chasing scroll/resize is exactly the
 * motion that preference asks this product to skip), and (2) every one of `ANCHOR_TARGET_IDS` is
 * already in the DOM the moment the tour opens. Condition (2) is what keeps the waiting room's
 * preview caller on today's modal, byte-for-byte: `WaitingChecklist`'s "See how the draft room
 * works" item never renders `RoomRail`/`RoomDock`/`PlayerPool` at all, so `room-clock`,
 * `dock-queue` and `player-pool` never exist there, and the anchor check fails every time. The
 * real draft room (`DraftRoom`, both formats) renders all three, so it gets the anchored tour.
 * Both branches share the identical `dismiss` below — one fire-and-forget guard around
 * `onDismiss`, not two.
 */
export function RoomTour({ dismissedAt, onDismiss, actionLabel }: RoomTourProps) {
  // Local, not derived solely from `dismissedAt`: the write that would update that prop is
  // best-effort and may never land (or may land after this component has already unmounted),
  // so closing has to be something this component can do to itself.
  const [dismissedLocally, setDismissedLocally] = useState(false);
  const open = dismissedAt === null && !dismissedLocally;
  const reducedMotion = usePrefersReducedMotion();
  const anchorsReady = useAnchorsReady(open);
  const anchored = open && !reducedMotion && anchorsReady;

  const dismiss = (): void => {
    try {
      onDismiss();
    } catch {
      // Best-effort: see the component docblock. The tour still closes, below.
    } finally {
      setDismissedLocally(true);
    }
  };

  if (anchored) {
    return <CoachMarks stops={anchoredStops(actionLabel)} onDismiss={dismiss} />;
  }

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
