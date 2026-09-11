import { QUILT_CONFIG } from "./config";

/**
 * THE STREAM'S THREE WIDTHS (founder ruling 2, 2026-09-10): open at 320, a 64px rail, or hidden
 * with a small "new" pill on the top strip. Remembered per browser; the rail is the desktop
 * default. The phone never asks: there the stream is the screen.
 */
export const STREAM_WIDTHS = ["open", "rail", "hidden"] as const;
export type StreamWidth = (typeof STREAM_WIDTHS)[number];

export const DEFAULT_STREAM_WIDTH: StreamWidth = "rail";

export function isStreamWidth(value: unknown): value is StreamWidth {
  return typeof value === "string" && (STREAM_WIDTHS as readonly string[]).includes(value);
}

/** The remembered width, or the default when the browser holds nothing usable or refuses to say.
 *  localStorage is external data and is validated like any other. */
export function readStreamWidth(): StreamWidth {
  try {
    const stored = window.localStorage.getItem(QUILT_CONFIG.streamWidthStorageKey);
    return isStreamWidth(stored) ? stored : DEFAULT_STREAM_WIDTH;
  } catch {
    return DEFAULT_STREAM_WIDTH;
  }
}

/** Best effort: a full or blocked store loses the memory, never the session's own width. */
export function writeStreamWidth(width: StreamWidth): void {
  try {
    window.localStorage.setItem(QUILT_CONFIG.streamWidthStorageKey, width);
  } catch {
    // The width still holds for this mount; only the memory across visits is lost.
  }
}

/** The collapse button walks one step narrower: open → rail → hidden. */
export function narrower(width: StreamWidth): StreamWidth {
  return width === "open" ? "rail" : "hidden";
}
