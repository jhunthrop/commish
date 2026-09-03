import { QUILT_CONFIG } from "./config";
import { decodeSheet, encodeSheet, seedSheet, type CheatSheet } from "./sheet";

/**
 * THE SEED SHEET (the workflow pass, law 4's "take it with you") — the bridge from a finished
 * mock to the next real room's cheat sheet.
 *
 * THE RECORDED JUDGMENT CALL: the cheat sheet is keyed PER DRAFT
 * (`QUILT_CONFIG.sheetStorageKeyPrefix` + draftId), so a mock cannot honestly target a real
 * league's sheet — at debrief time no real draft id exists to key on. The nearest honest
 * version, implemented here: SEED MY SHEET writes ONE well-known seed sheet (the caller's mock
 * picks in pick order, then the rest of that mock's own snapshot board in board order — a full
 * permutation, so `reconcileSheet` preserves the relative order against any future board), and
 * `useSheet` imports it ONLY for a draft with no stored sheet of its own. A sheet the manager
 * already edited always wins; the seed never overwrites prep. Same-browser only, lost with
 * cleared storage — exactly the sheet's own recorded posture ("prep words, never money or
 * picks").
 *
 * EXACTLY ONCE (fix round ruling): the seed is CONSUMED by its first successful import
 * (`takeSeedSheet` deletes as it reads). Seeding is a deliberate act aimed at the NEXT room
 * the manager opens — a standing seed would silently become the starting order of every
 * future sheet-less room, real leagues included, from a mock played arbitrarily long ago.
 */

/** "seed" can never collide with a draft id — every draft id is a UUID-shaped `deps.newId()`. */
export const SHEET_SEED_STORAGE_KEY = `${QUILT_CONFIG.sheetStorageKeyPrefix}seed`;

/** The seed's order: the manager's own mock picks first (pick order), then the rest of the
 *  mock's board in board order — a full permutation of that room's snapshot. */
export function seedOrderFrom(myPickPlayerIds: readonly string[], boardIds: readonly string[]): readonly string[] {
  const picked = new Set(myPickPlayerIds);
  return [...myPickPlayerIds, ...boardIds.filter((id) => !picked.has(id))];
}

/** Guarded like every sheet write: privacy modes throw on access, and a full store loses the
 *  seed, never the debrief. Returns whether the write actually landed. */
export function writeSeedSheet(order: readonly string[]): boolean {
  try {
    window.localStorage.setItem(SHEET_SEED_STORAGE_KEY, encodeSheet({ ...seedSheet([]), order }));
    return true;
  } catch {
    return false;
  }
}

/** Read AND consume: the seed serves exactly one room. Removal rides the same read so a
 *  successful import can never leave a stale seed behind; a decode failure also clears it
 *  (a corrupt seed is not worth keeping for a second try). */
export function takeSeedSheet(): CheatSheet | null {
  try {
    const raw = window.localStorage.getItem(SHEET_SEED_STORAGE_KEY);
    if (raw === null) return null;
    window.localStorage.removeItem(SHEET_SEED_STORAGE_KEY);
    return decodeSheet(raw);
  } catch {
    return null;
  }
}
