import { DEFAULT_BOARD_FORMAT, isBoardFormat, type BoardFormat } from "@research-ts/projections/preseason/board-formats";

/**
 * THE REMEMBERED FORMAT (the scoring-formats round, 2026-09-08) — which of the three boards a
 * league-free surface last showed this browser. Per browser, in `localStorage`, and never more than
 * a convenience: a missing, blocked or malformed value reads as the default, and every read and
 * write is wrapped because the accessor itself throws in a private window and in some previews.
 *
 * Pure module, no React: the picker and the HQ card read it from an effect after mount (the
 * server render and the client's first render must match), and a test drives it directly.
 */
export const BOARD_FORMAT_STORAGE_KEY = "commish.board.format";

export function readStoredBoardFormat(): BoardFormat {
  try {
    const value = window.localStorage.getItem(BOARD_FORMAT_STORAGE_KEY);
    return value !== null && isBoardFormat(value) ? value : DEFAULT_BOARD_FORMAT;
  } catch {
    return DEFAULT_BOARD_FORMAT;
  }
}

export function storeBoardFormat(format: BoardFormat): void {
  try {
    window.localStorage.setItem(BOARD_FORMAT_STORAGE_KEY, format);
  } catch {
    // A browser that refuses storage still gets the board it asked for; it simply is not remembered.
  }
}
