"use client";

import { useEffect, useRef, useState } from "react";
import { TOKENS } from "./tokens";
import { usePrefersReducedMotion } from "./use-reduced-motion";
import { useTransientVisibility } from "./use-transient-visibility";

/**
 * LAW 6's ONLY NEW MOTION: "true for a moment, because that number just changed."
 *
 * *"Motion reports, never performs. Nothing animates on mount, scroll or hover. Motion is
 * permitted only where a real value changed, a real clock is running, or a real event arrived.
 * Nothing eases longer than 250ms."* The live dot has a real clock and the wire has real events;
 * this hook is the third and last case — a value that changed because the world changed. A score
 * that jumps silently is unsettling, and the wash is how the interface says which cell moved
 * without a manager having to have been looking at it.
 *
 * **IT CANNOT FIRE ON MOUNT.** Nothing changed on mount: the number was not there and then there,
 * it simply arrived, and washing the whole table on first paint is the "performs" half of law 6
 * exactly. That is what `changeCount === 0` buys — the counter starts at zero, the first render
 * hands `useTransientVisibility` a `null` key, and a null key is never visible. The counter only
 * moves in an effect comparing against the previous value, so a re-render with the SAME value
 * (a parent re-rendering for its own reasons, a re-delivered socket message carrying a figure
 * already on screen) washes nothing.
 *
 * **THE REDUCED-MOTION BRANCH REMOVES THE BEHAVIOUR, it does not soften it.** When the user has
 * asked for less motion this returns `false` forever, so no consumer ever renders a highlight and
 * no timer is ever armed — the key is forced back to `null` before `useTransientVisibility` sees
 * it. This is deliberately NOT the globals.css `prefers-reduced-motion` net (which only shortens
 * durations to 0.01ms): a one-frame flash of a changed cell is still a flash, and the point is
 * that the number simply updates, silently, the way it would in a table with no motion at all.
 * The information is not carried by the wash in the first place — the new number IS the
 * information — so nothing is lost by removing it, which is the test of whether an animation was
 * ever reporting rather than performing.
 *
 * **IT REUSES `useTransientVisibility` RATHER THAN REBUILDING IT.** "Show this for `ms`, keyed on
 * `key`" is precisely the machinery here, timer cleanup and re-trigger semantics included; a
 * second copy would be the same bug surface twice. All this adds is the derivation of a key from
 * a value that changed, and the duration: `TOKENS.motion.duration.highlight`, the 600ms wash P4
 * allows on a row whose value just changed, one token and deliberately not two names for one
 * fact (see the token's docblock).
 *
 * Consumers render the wash however their surface needs (a background transition, a ring). This
 * hook returns a boolean and paints nothing, so it stays usable from a table cell, a scoreboard
 * and a feed row without any of them inheriting the others' styling.
 */
export function useValueChangeHighlight(value: string | number): boolean {
  const reduced = usePrefersReducedMotion();
  const previous = useRef(value);
  const [changeCount, setChangeCount] = useState(0);

  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setChangeCount((count) => count + 1);
  }, [value]);

  // `null` on both branches that must never show: the first render (nothing has changed yet) and
  // the reduced-motion branch (nothing may change visibly at all). A null key means
  // `useTransientVisibility` schedules no timer, so the branch is an absence of behaviour rather
  // than a suppressed one.
  const key = reduced || changeCount === 0 ? null : changeCount;
  // SIDELINE: the wash on a changed number runs 600ms (`highlight`), the one motion the direction
  // states longer than its 150 to 400ms transition band, and the row's new figure slides up
  // under it (`animate-score-slide`, the consumer's own class).
  return useTransientVisibility(key, TOKENS.motion.duration.highlight);
}
