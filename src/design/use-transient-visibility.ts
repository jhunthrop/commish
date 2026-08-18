"use client";

import { useEffect, useState } from "react";

/**
 * "Show this for `ms`, keyed on `key`." The key is what makes a re-delivered event harmless:
 * the same key never re-triggers, and a new one always does. Extracted because both
 * celebrations need exactly this and a second copy would drift.
 */
export function useTransientVisibility(key: string | number | null, ms: number): boolean {
  const [visible, setVisible] = useState(key !== null);

  useEffect(() => {
    if (key === null) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), ms);
    return () => clearTimeout(timer);
  }, [key, ms]);

  return key !== null && visible;
}
