"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QUILT_CONFIG } from "../state/config";
import { decodeSheet, encodeSheet, moveInSheet, reconcileSheet, seedSheet, setSheetNote, type CheatSheet } from "../state/sheet";
import { readSeedSheet } from "../state/sheet-seed";

export interface SheetControls {
  readonly sheet: CheatSheet;
  readonly move: (playerId: string, delta: number) => void;
  readonly note: (playerId: string, note: string) => void;
  /** Back to the board's own order; notes survive a reset — words are prep, order is opinion. */
  readonly reset: () => void;
}

function storageKeyFor(draftId: string): string {
  return `${QUILT_CONFIG.sheetStorageKeyPrefix}${draftId}`;
}

/** Guarded reads/writes: privacy modes throw on access, and a sheet must never crash a room. */
function readStored(draftId: string): CheatSheet | null {
  try {
    return decodeSheet(window.localStorage.getItem(storageKeyFor(draftId)));
  } catch {
    return null;
  }
}

function writeStored(draftId: string, sheet: CheatSheet): void {
  try {
    window.localStorage.setItem(storageKeyFor(draftId), encodeSheet(sheet));
  } catch {
    // A full or blocked store loses persistence, never the session's own sheet.
  }
}

/**
 * The sheet's persistence seam. Seeds from the board (or the stored copy reconciled against it)
 * the first time the board arrives, persists every edit, and hands the drawer the immutable ops.
 * `boardIds` is the server-ranked order `useDraftRoom` already serves — this hook never ranks.
 */
export function useSheet(draftId: string, boardIds: readonly string[]): SheetControls {
  const [sheet, setSheet] = useState<CheatSheet>(() => seedSheet([]));
  const seededForRef = useRef<string | null>(null);

  useEffect(() => {
    if (boardIds.length === 0 || seededForRef.current === draftId) return;
    seededForRef.current = draftId;
    const stored = readStored(draftId);
    if (stored !== null) {
      setSheet(reconcileSheet(stored, boardIds));
      return;
    }
    // No sheet of this draft's own yet: import the standing seed sheet if one exists (the
    // finished-mock debrief's SEED MY SHEET, `../state/sheet-seed`) — reconciled against THIS
    // room's board, so ids the board does not serve drop and new arrivals slot in at board
    // position. A sheet the manager has edited is never touched by this branch at all.
    const seed = readSeedSheet();
    setSheet(seed === null ? seedSheet(boardIds) : reconcileSheet(seed, boardIds));
  }, [draftId, boardIds]);

  const apply = useCallback(
    (next: (current: CheatSheet) => CheatSheet): void => {
      setSheet((current) => {
        const updated = next(current);
        if (updated !== current) writeStored(draftId, updated);
        return updated;
      });
    },
    [draftId],
  );

  const move = useCallback((playerId: string, delta: number) => apply((current) => moveInSheet(current, playerId, delta)), [apply]);
  const note = useCallback((playerId: string, text: string) => apply((current) => setSheetNote(current, playerId, text)), [apply]);
  const reset = useCallback(() => apply((current) => ({ ...seedSheet(boardIds), notes: current.notes })), [apply, boardIds]);

  return useMemo(() => ({ sheet, move, note, reset }), [sheet, move, note, reset]);
}
