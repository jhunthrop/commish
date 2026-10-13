/**
 * Your sheet in this browser, before you sign in: the players you added, in your order. The sheet
 * lane (Lane 7) owns the sheet itself, its tiers, tags and notes, and the sync to your account; this
 * module is the one place the browser copy is read and written, so the board's rail, the player
 * page's verb and the sheet page share it. Every write returns a new sheet and never edits one.
 */
import type { StorageGetter } from '#lib/ui/theme.ts';

export const SHEET_STORAGE_KEY = 'commish-sheet';
const SHEET_VERSION = 1;

export interface SheetRow {
	playerId: string;
	/** When it was added, ISO. */
	addedAt: string;
}

export interface LocalSheet {
	version: typeof SHEET_VERSION;
	rows: readonly SheetRow[];
}

export const EMPTY_SHEET: LocalSheet = { version: SHEET_VERSION, rows: [] };

function isSheetRow(value: unknown): value is SheetRow {
	if (typeof value !== 'object' || value === null) return false;
	const row = value as Record<string, unknown>;
	return typeof row.playerId === 'string' && typeof row.addedAt === 'string';
}

/** The sheet as saved, or empty when nothing is saved, storage is blocked, or the copy is unreadable. */
export function readSheet(getStorage: StorageGetter): LocalSheet {
	try {
		const raw = getStorage().getItem(SHEET_STORAGE_KEY);
		if (raw === null) return EMPTY_SHEET;
		const parsed = JSON.parse(raw) as { version?: unknown; rows?: unknown };
		if (parsed.version !== SHEET_VERSION || !Array.isArray(parsed.rows)) return EMPTY_SHEET;
		return { version: SHEET_VERSION, rows: parsed.rows.filter(isSheetRow) };
	} catch {
		return EMPTY_SHEET;
	}
}

/** The sheet with this player at the bottom, or the same sheet when he is already on it. */
export function withPlayer(sheet: LocalSheet, playerId: string, at: Date): LocalSheet {
	if (sheet.rows.some((row) => row.playerId === playerId)) return sheet;
	return { ...sheet, rows: [...sheet.rows, { playerId, addedAt: at.toISOString() }] };
}

/** Saves the sheet. Storage can be blocked or full, and then the add lasts this visit only. */
export function saveSheet(getStorage: StorageGetter, sheet: LocalSheet): boolean {
	try {
		getStorage().setItem(SHEET_STORAGE_KEY, JSON.stringify(sheet));
		return true;
	} catch {
		return false;
	}
}
