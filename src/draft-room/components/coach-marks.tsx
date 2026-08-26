"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui";

export interface CoachMarkStop {
  readonly heading: string;
  readonly body: string;
  /** `null` for the closing stop (it has nothing to point at, so it centers), and also for a
   *  stop whose element vanished from the DOM after the tour opened — either way the popover
   *  centers rather than pointing at a rect that no longer means anything. */
  readonly targetId: string | null;
}

export interface CoachMarksProps {
  readonly stops: readonly CoachMarkStop[];
  /**
   * Closes the WHOLE tour. `RoomTour` is the one place that wraps a real `onDismiss` in its own
   * fire-and-forget try/catch (see that component's docblock) — this component calls it
   * directly, on "Got it" and on Esc, so there is exactly one guard around the real dismissal
   * write, not one per caller.
   */
  readonly onDismiss: () => void;
}

/** Tailwind's `lg` — the same breakpoint the room frame itself stops scrolling at
 *  (`RoomLayout`). Below it the linearized page scrolls, so the popover pins to the viewport
 *  bottom instead of tracking the target's rect through a scroll — the simpler of the two
 *  options the design brief sanctions, chosen over a passive scroll listener because a coach
 *  mark's own job (say what a nearby control does) survives being anchored to "the bottom of
 *  the screen" on a phone just as well as being anchored to the control's own edge. The
 *  highlight ring below still tracks the target's real rect either way. */
const MOBILE_BREAKPOINT_PX = 1024;

/** `max-w-80` (20rem) — the popover's own Tailwind cap — as a number, so the placement math has
 *  a real width to clamp against before the popover has ever painted a pixel. */
const POPOVER_ASSUMED_WIDTH = 320;
/** A generous estimate for a heading, two sentences of body copy and a footer row — clamping
 *  math only needs to be "big enough to avoid an off-screen popover," never pixel-exact; the
 *  popover's own CSS still determines its real rendered size. */
const POPOVER_ASSUMED_HEIGHT = 220;

export const COACH_MARK_MARGIN = 8;

export interface CoachMarkRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export interface CoachMarkViewport {
  readonly width: number;
  readonly height: number;
}

export interface CoachMarkPlacement {
  readonly top: number;
  readonly left: number;
  readonly side: "below" | "above";
}

/**
 * THE PLACEMENT MATH, pure. Below the target when the popover's own (assumed) height fits in
 * the remaining viewport space; above it otherwise. Left-aligned with the target, then both
 * axes clamped inside an 8px margin on every edge. Exported and pure on purpose: happy-dom's
 * `getBoundingClientRect` always answers all-zero rects, which makes the real, mounted
 * component impossible to assert pixel math against — this function takes literal rects, so it
 * is the one thing in this file a test can actually pin numbers to.
 */
export function placeCoachMark(
  target: CoachMarkRect,
  popover: CoachMarkRect,
  viewport: CoachMarkViewport,
  margin: number = COACH_MARK_MARGIN,
): CoachMarkPlacement {
  const spaceBelow = viewport.height - (target.top + target.height + margin) - margin;
  const side: "below" | "above" = spaceBelow >= popover.height ? "below" : "above";
  const rawTop = side === "below" ? target.top + target.height + margin : target.top - margin - popover.height;
  const maxTop = Math.max(margin, viewport.height - popover.height - margin);
  const maxLeft = Math.max(margin, viewport.width - popover.width - margin);
  return {
    top: Math.min(Math.max(rawTop, margin), maxTop),
    left: Math.min(Math.max(target.left, margin), maxLeft),
    side,
  };
}

function rectOf(element: Element): CoachMarkRect {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

/**
 * The anchored tour (R3): one popover at a time, pointing at the real control it describes,
 * with an outline drawn over that control rather than any dimming of the room around it — the
 * room stays fully visible and fully interactive on purpose. `RoomTour` is the only caller,
 * and only once it has confirmed every non-null `targetId` among `stops` already exists in the
 * DOM (its own docblock) — this component still degrades a single stop to centered if that
 * stop's target is `null` or disappears later, but it does not itself decide whole-tour
 * fallback to the modal.
 *
 * No focus trap: the room below a coach mark stays tabbable, and dismissing one by using the
 * control it points at (queuing a player while "The queue" is showing, say) is a feature of an
 * anchored walkthrough, not a bug to guard against. Focus moves to "Got it" on every stop
 * change, including the first, and reverts to `document.body` the ordinary way once that
 * button leaves the DOM on dismiss — there is nothing else for this component to hand it back
 * to.
 */
export function CoachMarks({ stops, onDismiss }: CoachMarksProps) {
  const [index, setIndex] = useState(0);
  const [resizeTick, setResizeTick] = useState(0);
  // Read from the DOM only inside an effect, never during render: the sibling elements this
  // component points at (the rail's clock, the dock's queue, the pool) commit to the real DOM in
  // the SAME pass as this component, so a render-phase `document.getElementById` call would run
  // before React has written any of them and always come back empty. `useLayoutEffect` runs
  // after commit but before paint, so the popover never visibly flashes centered first.
  const [targetRect, setTargetRect] = useState<CoachMarkRect | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const gotItRef = useRef<HTMLButtonElement | null>(null);

  const stop = stops[Math.min(index, stops.length - 1)]!;
  const isLast = index >= stops.length - 1;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onDismiss]);

  useEffect(() => {
    // One listener for the whole tour — every stop's placement is recomputed from the current
    // target rect and viewport on the next render, not tracked separately per stop.
    const onResize = () => setResizeTick((tick) => tick + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    const targetId = stop.targetId;
    const el = targetId === null ? null : document.getElementById(targetId);
    setTargetRect(el === null ? null : rectOf(el));
    // `resizeTick` is a dependency purely to force this to re-run on resize — its value is
    // never read.
  }, [stop.targetId, resizeTick]);

  useEffect(() => {
    gotItRef.current?.focus();
  }, [index]);

  const isMobile = typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT_PX;

  let popoverStyle: CSSProperties;
  if (targetRect === null) {
    popoverStyle = { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  } else if (isMobile) {
    popoverStyle = { bottom: COACH_MARK_MARGIN, left: "50%", transform: "translateX(-50%)" };
  } else {
    const viewport: CoachMarkViewport = { width: window.innerWidth, height: window.innerHeight };
    const popoverRect: CoachMarkRect = { top: 0, left: 0, width: POPOVER_ASSUMED_WIDTH, height: POPOVER_ASSUMED_HEIGHT };
    const placement = placeCoachMark(targetRect, popoverRect, viewport);
    popoverStyle = { top: placement.top, left: placement.left };
  }

  return (
    <>
      {targetRect === null ? null : (
        // No animation (only true things move) and no dim backdrop — the room stays fully
        // visible, which is the whole point of an anchored tour over the modal it replaces.
        <div
          aria-hidden="true"
          data-testid="coach-mark-highlight"
          className="pointer-events-none fixed z-40 rounded-sm border-2 border-text-primary"
          style={{ top: targetRect.top, left: targetRect.left, width: targetRect.width, height: targetRect.height }}
        />
      )}
      <div
        ref={popoverRef}
        role="dialog"
        aria-label={stop.heading}
        className="fixed z-50 max-w-80 rounded-sm border border-line bg-surface-elevated p-4 shadow-card"
        style={popoverStyle}
      >
        <h3 className="font-semibold text-text-primary">{stop.heading}</h3>
        <p className="mt-1 text-sm text-text-muted">{stop.body}</p>
        <div className="mt-4 flex justify-end gap-2">
          {isLast ? null : (
            <Button variant="ghost" onClick={() => setIndex((current) => current + 1)}>
              Next
            </Button>
          )}
          <Button ref={gotItRef} variant="secondary" onClick={onDismiss}>
            Got it
          </Button>
        </div>
      </div>
    </>
  );
}
