"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SheetWithEntries } from "@/draft-hq/sheet/types";
import { useDraftRoomDeps } from "@/draft-room/hooks/deps";
import { QUILT_CONFIG } from "../state/config";
import { decodeSheet, encodeSheet, moveInSheet, placeInSheet, reconcileSheet, seedSheet, setSheetNote, type CheatSheet } from "../state/sheet";
import { takeSeedSheet } from "../state/sheet-seed";

export interface SheetControls {
  readonly sheet: CheatSheet;
  readonly move: (playerId: string, delta: number) => void;
  /** Put a player at a place on the sheet (the drag drop). */
  readonly place: (playerId: string, to: number) => void;
  readonly note: (playerId: string, note: string) => void;
  /** Back to the board's own order; notes survive a reset — words are prep, order is opinion. */
  readonly reset: () => void;
  /** Whether this room found a server sheet (Draft HQ's My Sheet store) to sync with — spec §4's
   *  sync contract. `false` for a league with no server sheet yet, in which case every write
   *  above still behaves exactly as it always has (local-only). */
  readonly hasServerSheet: boolean;
  /** Creates a server sheet for this league from the room's CURRENT local sheet (order and
   *  notes preserved) and switches every future write onto it. A no-op once one already exists. */
  readonly startServerSheet: () => void;
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

function cheatSheetFrom(server: SheetWithEntries): CheatSheet {
  const order = [...server.entries].sort((a, b) => a.rank - b.rank).map((entry) => entry.playerId);
  const notes = Object.fromEntries(server.entries.flatMap((entry) => (entry.note === null || entry.note === "" ? [] : [[entry.playerId, entry.note] as const])));
  return { order, notes };
}

/**
 * The sheet's persistence seam. Seeds from the board (or the stored copy reconciled against it)
 * the first time the board arrives, persists every edit, and hands the drawer the immutable ops.
 * `boardIds` is the server-ranked order `useDraftRoom` already serves — this hook never ranks.
 *
 * THE SYNC CONTRACT (spec §4, Draft HQ phase 1, Task 5): when `leagueId` is given, this hook
 * ALSO looks for a Draft HQ sheet for that league (`GET /api/draft/sheets/default`) and, if one
 * exists, makes it the source of truth — every `move`/`note`/`reset` after that point writes
 * through to `/api/draft/sheets/[id]/entries` as well as to `localStorage`, fire-and-forget (a
 * failed server write never blocks or reverts the room's own optimistic local state, the same
 * resilience posture `writeStored`'s own try/catch already holds for a full or blocked browser
 * store). A caller with NO server sheet yet gets exactly today's local-only behavior, unchanged —
 * `hasServerSheet` is `false` and `startServerSheet` offers to create one from what is already on
 * screen. `leagueId` omitted (every existing caller, every existing test) skips this whole path:
 * no fetch is ever attempted, so nothing here can change behavior nobody opted into.
 */
export function useSheet(draftId: string, boardIds: readonly string[], leagueId?: string | null): SheetControls {
  const { fetchJson } = useDraftRoomDeps();
  const [sheet, setSheet] = useState<CheatSheet>(() => seedSheet([]));
  const [serverSheetId, setServerSheetId] = useState<string | null>(null);
  const seededForRef = useRef<string | null>(null);
  const serverCheckedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (boardIds.length === 0 || seededForRef.current === draftId) return;
    seededForRef.current = draftId;
    const stored = readStored(draftId);
    if (stored !== null) {
      setSheet(reconcileSheet(stored, boardIds));
      return;
    }
    // No sheet of this draft's own yet: import the seed sheet if one exists (the finished-mock
    // debrief's SEED MY SHEET, `../state/sheet-seed`) — reconciled against THIS room's board,
    // so ids the board does not serve drop and new arrivals slot in at board position. The
    // take CONSUMES the seed: it serves exactly this one room, never a later one. A sheet the
    // manager has edited is never touched by this branch at all.
    const seed = takeSeedSheet();
    setSheet(seed === null ? seedSheet(boardIds) : reconcileSheet(seed, boardIds));
  }, [draftId, boardIds]);

  // THE SERVER LOOKUP — runs once per draft, only when a leagueId is actually given. A server
  // sheet, once found, overrides whatever the effect above just set (local storage or a seed):
  // Draft HQ's own store is the sync contract's source of truth the moment it exists.
  useEffect(() => {
    if (leagueId === undefined || leagueId === null) return;
    if (serverCheckedForRef.current === draftId) return;
    serverCheckedForRef.current = draftId;
    let alive = true;
    void (async () => {
      try {
        const response = await fetchJson(`/api/draft/sheets/default?leagueId=${encodeURIComponent(leagueId)}`);
        const envelope = (await response.json()) as { readonly ok: boolean; readonly data?: SheetWithEntries | null };
        if (!alive || !envelope.ok || envelope.data === null || envelope.data === undefined) return;
        setServerSheetId(envelope.data.id);
        setSheet(reconcileSheet(cheatSheetFrom(envelope.data), boardIds));
      } catch {
        // No server sheet reachable — the room falls back to its own local behavior, unchanged.
      }
    })();
    return () => {
      alive = false;
    };
    // `boardIds` deliberately excluded: this lookup runs once per draft id, not once per board
    // reference change, and `reconcileSheet` is applied again by the seeding effect above if the
    // board changes before this resolves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, leagueId, fetchJson]);

  const syncServer = useCallback(
    (order: readonly string[]) => {
      if (serverSheetId === null) return;
      void fetchJson(`/api/draft/sheets/${serverSheetId}/entries`, { method: "PUT", body: JSON.stringify({ order }) }).catch(() => {
        // Fire-and-forget: the room's own local state and localStorage already hold the edit.
      });
    },
    [serverSheetId, fetchJson],
  );

  const syncServerNote = useCallback(
    (playerId: string, text: string) => {
      if (serverSheetId === null) return;
      void fetchJson(`/api/draft/sheets/${serverSheetId}/entries`, { method: "POST", body: JSON.stringify({ playerId, note: text }) }).catch(() => {});
    },
    [serverSheetId, fetchJson],
  );

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

  const move = useCallback(
    (playerId: string, delta: number) => {
      apply((current) => {
        const updated = moveInSheet(current, playerId, delta);
        if (updated !== current) syncServer(updated.order);
        return updated;
      });
    },
    [apply, syncServer],
  );
  const place = useCallback(
    (playerId: string, to: number) => {
      apply((current) => {
        const updated = placeInSheet(current, playerId, to);
        if (updated !== current) syncServer(updated.order);
        return updated;
      });
    },
    [apply, syncServer],
  );
  const note = useCallback(
    (playerId: string, text: string) => {
      apply((current) => setSheetNote(current, playerId, text));
      syncServerNote(playerId, text);
    },
    [apply, syncServerNote],
  );
  const reset = useCallback(() => {
    apply((current) => {
      const updated = { ...seedSheet(boardIds), notes: current.notes };
      syncServer(updated.order);
      return updated;
    });
  }, [apply, boardIds, syncServer]);

  const startServerSheet = useCallback(() => {
    if (leagueId === undefined || leagueId === null || serverSheetId !== null) return;
    void (async () => {
      try {
        const created = await fetchJson("/api/draft/sheets", { method: "POST", body: JSON.stringify({ name: "My sheet", leagueId }) });
        const createdEnvelope = (await created.json()) as { readonly ok: boolean; readonly data?: { readonly id: string } };
        if (!createdEnvelope.ok || createdEnvelope.data === undefined) return;
        const entries = sheet.order.map((playerId) => ({ playerId, note: sheet.notes[playerId] ?? null }));
        await fetchJson(`/api/draft/sheets/${createdEnvelope.data.id}/replace`, { method: "PUT", body: JSON.stringify({ entries }) });
        setServerSheetId(createdEnvelope.data.id);
      } catch {
        // Starting a server sheet is a convenience; a failure leaves the room on local-only
        // behavior, exactly where it already was.
      }
    })();
  }, [leagueId, serverSheetId, fetchJson, sheet]);

  return useMemo(
    () => ({ sheet, move, place, note, reset, hasServerSheet: serverSheetId !== null, startServerSheet }),
    [sheet, move, place, note, reset, serverSheetId, startServerSheet],
  );
}
