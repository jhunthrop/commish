"use client";

import { useLayoutEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import { REDUCED_MOTION_QUERY } from "@/design/use-reduced-motion";
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
 * The closing stop's own sentence (Task 9, Step 1) — its first half is C3's own safety-net
 * phrase, verbatim, the ONE sanctioned way this product reassures anyone about missing a draft
 * (`docs/design-system.md`'s "Copy" section, `copy-rules.ts`'s `FORBIDDEN_VOCABULARY` family).
 * The second half used to be copied word-for-word from `MOCK_COPY.lobbyEmptyActionLabel`
 * (`@/mock-draft/config`); the lobby design review (2026-08-26) retired that bare "Start a mock
 * draft" phrase (and the workflow pass later replaced the lobby surface entirely), so there is
 * no longer a single static MOCK_COPY phrase to mirror here. This sentence is now its OWN standalone copy, still swept by
 * `src/integrity/rendered-copy.test.tsx` for the house copy rules, just no longer pinned against
 * a value in `@/mock-draft/config` — `src/draft-room/**` may not value-import that module anyway
 * (the client boundary), the identical reason `PracticeBanner`/`MockResults` receive its words as
 * PROPS rather than a live import.
 */
const CLOSING_STOP: TourStop = {
  heading: "Practice anytime",
  body: "Run a mock draft first. Same room, practice opponents, nothing counts.",
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
      body: "When it hits zero, the room picks for you: your queue first, then the best player your roster needs.",
    },
    { heading: "The queue", body: "Stack the players you want. When you miss a turn the room picks for you: your queue first, then the best player your roster needs." },
    {
      heading: "Taking your turn",
      body: `${actionLabel} the player you want before the clock runs out. Miss it and the room picks for you: your queue first, then the best player your roster needs.`,
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
function useAnchoredPresentation(active: boolean): boolean {
  const [ready, setReady] = useState(false);

  // `useLayoutEffect`, not `useEffect`: this runs synchronously right after the SAME commit
  // that first mounts `RoomTour` alongside `RoomRail`/`RoomDock`/`PlayerPool` (they are siblings
  // in `DraftRoom`'s own return, so their DOM lands in one commit together) and before the
  // browser paints — a plain `useEffect` here left a real, observable frame where this component
  // had already rendered its (stale, default-`false`) modal fallback before flipping to
  // anchored, which is both a visible flash in the room and a race any `waitFor` polling for a
  // dialog could catch mid-flip.
  //
  // BOTH halves of the decision live in this one effect (T4 review HIGH): the reduced-motion
  // preference is read here directly rather than through `usePrefersReducedMotion`, whose
  // post-paint `useEffect` shape (right for everything that merely tones motion down) would
  // leave its half of the gate stale-`false` at this effect's own pre-paint flip — the first
  // paint could show the anchored tour to the exact audience the modal fallback protects,
  // then snap to the modal a frame later. One layout effect, one paint-safe answer. Read once
  // per open, not subscribed: the tour is transient, and re-deciding presentation mid-tour
  // would teleport an open popover.
  useLayoutEffect(() => {
    if (!active) {
      setReady(false);
      return;
    }
    const reduced = window.matchMedia(REDUCED_MOTION_QUERY).matches;
    setReady(!reduced && ANCHOR_TARGET_IDS.every((id) => document.getElementById(id) !== null));
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
 * the reduced-motion media query does not match (a moving popover chasing scroll/resize is
 * exactly the motion that preference asks this product to skip — read pre-paint inside
 * `useAnchoredPresentation`, see its docblock), and (2) every one of `ANCHOR_TARGET_IDS` is
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
  const anchoredReady = useAnchoredPresentation(open);
  const anchored = open && anchoredReady;

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
