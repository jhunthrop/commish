"use client";

import { useEffect, useRef, useState } from "react";
import { TOKENS } from "./tokens";
import { usePrefersReducedMotion } from "./use-reduced-motion";

/**
 * SIDELINE'S MOTION VERBS (P4: every live event moves, and nothing else does). Two of the four
 * verbs are entrances and one is a leave; the fourth, the changed-number wash, already lives in
 * `useValueChangeHighlight`. Each class below is defined once in `globals.css` against the
 * generated duration and easing variables, and a component asks for it by name here so the
 * reduced-motion branch is decided in one place: when the reader asked for less motion these
 * hooks return an empty class and an instant leave, never a shorter animation. Everything a
 * motion says is also said by the state change it rides on, so nothing is lost.
 */
export type EntranceKind = "in" | "celebrate";

const ENTRANCE_CLASS: Readonly<Record<EntranceKind, string>> = {
  /** Anything that arrives: a card dealt, a message landing, a sheet rising. 240ms on the spring. */
  in: "animate-spring-in",
  /** The one longer motion per moment: the celebration frame's slap-in (Tailgate's, borrowed). */
  celebrate: "animate-slap-in",
};

/** The class an arriving element wears, or nothing at all under reduced motion. */
export function useEntranceClass(kind: EntranceKind = "in"): string {
  const reduced = usePrefersReducedMotion();
  return entranceClass(kind, reduced);
}

/** The same choice as a pure function, for a memoized list or grid that reads the reduced-motion
 *  answer once at its root and hands each child its class rather than subscribing every cell. */
export function entranceClass(kind: EntranceKind, reduced: boolean): string {
  return reduced ? "" : ENTRANCE_CLASS[kind];
}

export interface LeaveTransition {
  /** Keep the element in the tree while this is true: it is open, or it is still easing out. */
  readonly mounted: boolean;
  /** True only during the ease-out, so the element can wear `className`. */
  readonly leaving: boolean;
  /** `animate-ease-out` while leaving, otherwise empty. */
  readonly className: string;
}

/**
 * "Keep me mounted for the 180ms ease-out after `open` turns false." The element leaves
 * immediately under reduced motion, which is the branch that removes the behaviour rather than
 * shortening it. Opening again mid-leave cancels the leave and keeps the element.
 */
export function useLeaveTransition(open: boolean): LeaveTransition {
  const reduced = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(open);
  const [leaving, setLeaving] = useState(false);
  const wasOpen = useRef(open);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setLeaving(false);
      setMounted(true);
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (reduced) {
      setMounted(false);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => {
      setLeaving(false);
      setMounted(false);
    }, TOKENS.motion.duration.out);
    return () => clearTimeout(timer);
  }, [open, reduced]);

  return { mounted, leaving, className: leaving ? "animate-ease-out" : "" };
}
