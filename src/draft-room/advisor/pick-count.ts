"use client";

import { useCallback, useEffect, useState } from "react";
import { ADVISOR_ROOM_CONFIG, type PickCount } from "./config";

const { options, default: DEFAULT_COUNT, storageKey } = ADVISOR_ROOM_CONFIG.pickCount;

export function isPickCount(value: number): value is PickCount {
  return (options as readonly number[]).includes(value);
}

/** The remembered count, or the default when the browser holds nothing usable or refuses to say.
 *  localStorage is external data and is validated like any other. */
export function readPickCount(): PickCount {
  try {
    const parsed = Number(window.localStorage.getItem(storageKey));
    return isPickCount(parsed) ? parsed : DEFAULT_COUNT;
  } catch {
    return DEFAULT_COUNT;
  }
}

/** Best effort: a full or blocked store loses the memory, never the tab. */
export function writePickCount(count: PickCount): void {
  try {
    window.localStorage.setItem(storageKey, String(count));
  } catch {
    // The selection still holds for this mount; only the memory across visits is lost.
  }
}

/**
 * THE SELECTOR'S STATE. Starts at the default on every render pass (server and first client
 * paint agree, so hydration never mismatches), reads the browser's memory once after mount, and
 * writes through on every change.
 */
export function usePickCount(): readonly [PickCount, (count: PickCount) => void] {
  const [count, setCount] = useState<PickCount>(DEFAULT_COUNT);
  useEffect(() => {
    setCount(readPickCount());
  }, []);
  const choose = useCallback((next: PickCount) => {
    setCount(next);
    writePickCount(next);
  }, []);
  return [count, choose] as const;
}
