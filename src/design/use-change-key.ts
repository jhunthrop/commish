"use client";

import { useState } from "react";

interface Tracked<T> {
  readonly value: T;
  readonly key: number;
}

/**
 * A counter that steps each time `value` changes: 0 on mount, 1 after the first change, and so
 * on. A consumer keys an element on it so a changed figure re-mounts and its CSS animation
 * (`MOTION.swap`) replays — the cross-fade a changed number is allowed to make (law 6: a real
 * value changed). Nothing happens on mount, because nothing changed on mount.
 *
 * Adjusts state DURING render (React's own "storing information from previous renders" idiom)
 * rather than in an effect, so the new key is on screen in the same commit as the new value —
 * an effect would paint the new number first and replay the animation one frame late.
 */
export function useChangeKey<T extends string | number | null>(value: T): number {
  const [tracked, setTracked] = useState<Tracked<T>>({ value, key: 0 });
  if (tracked.value !== value) {
    const next = { value, key: tracked.key + 1 };
    setTracked(next);
    return next.key;
  }
  return tracked.key;
}
