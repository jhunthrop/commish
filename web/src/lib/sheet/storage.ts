/**
 * The sheet in this browser: the working copy, signed in or out. Signed out it is the only copy.
 * Signed in it is what the page shows at once while the account's copy loads, and what is kept
 * when a save cannot reach the account. Beside it the browser keeps the sheet as the account held
 * it at the last sync (the common ancestor merge.ts needs) and a shelf of sheets saved here that
 * are not on the account yet. Storage is outside data, so a read trusts nothing: a copy that does
 * not parse reads as no copy, and each row is checked and cut to the sheet's limits.
 */
import type { StorageGetter } from '#lib/ui/theme.ts';
import { SHEET_LIMITS } from './limits.ts';
import { parseFormat } from './format.ts';
import { emptySheet, parsePosition, type Sheet, type SheetRow } from './model.ts';
import { normalizeTags } from './tags.ts';
import { repairTiers } from './tiers.ts';

export const SHEET_STORAGE_KEY = 'commish-sheet';
const VERSION = 3;
/** How many sheets the shelf keeps, the account's limit. */
export const SHELF_LIMIT = 50;

/** Which account sheet this copy was last saved to, and that sheet's updated_at then. */
export interface SyncMark {
	sheetId: string;
	updatedAt: string;
}

export interface StoredSheet {
	sheet: Sheet;
	/** When this browser last changed the sheet, ISO, or null for a sheet it never edited. */
	editedAt: string | null;
	/** True while this browser has edits the account has not acknowledged. */
	dirty: boolean;
	sync: SyncMark | null;
	/** The sheet as the account held it at the last successful sync, or null before one. */
	base: Sheet | null;
	/** Sheets saved in this browser beside this one (a saved draft while signed out or offline),
	 * created on the account at the next sync. */
	shelf: readonly Sheet[];
}

export const EMPTY_STORED: StoredSheet = {
	sheet: emptySheet(),
	editedAt: null,
	dirty: false,
	sync: null,
	base: null,
	shelf: []
};

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null;
const text = (value: unknown, max: number): string | null =>
	typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null;

function readRow(value: unknown): SheetRow | null {
	if (!isObject(value)) return null;
	const id = text(value.id, SHEET_LIMITS.playerId);
	const name = text(value.name, SHEET_LIMITS.playerName);
	const position = typeof value.position === 'string' ? parsePosition(value.position) : null;
	if (id === null || name === null || position === null) return null;
	const tier =
		typeof value.tier === 'number' && Number.isInteger(value.tier) && value.tier >= 1
			? Math.min(value.tier, SHEET_LIMITS.tier)
			: null;
	const tags = Array.isArray(value.tags)
		? normalizeTags(value.tags.filter((tag): tag is string => typeof tag === 'string'))
		: [];
	const headshot = text(value.headshot, SHEET_LIMITS.headshot);
	return {
		id,
		name,
		position,
		team: text(value.team, SHEET_LIMITS.team),
		headshot: headshot?.startsWith('https://') ? headshot : null,
		tier,
		tags,
		note: text(value.note, SHEET_LIMITS.note)
	};
}

function readSheet(value: unknown): Sheet | null {
	if (!isObject(value) || !Array.isArray(value.rows)) return null;
	const format = parseFormat(value.format) ?? emptySheet().format;
	const seen = new Set<string>();
	const rows: SheetRow[] = [];
	for (const raw of value.rows) {
		const row = readRow(raw);
		if (row === null || seen.has(row.id) || rows.length >= SHEET_LIMITS.rows) continue;
		seen.add(row.id);
		rows.push(row);
	}
	const name = text(value.name, SHEET_LIMITS.sheetName) ?? emptySheet().name;
	return { name, format, rows: repairTiers(rows) };
}

function readSync(value: unknown): SyncMark | null {
	if (!isObject(value)) return null;
	const sheetId = text(value.sheetId, 64);
	const updatedAt = text(value.updatedAt, 64);
	return sheetId && updatedAt && !Number.isNaN(Date.parse(updatedAt))
		? { sheetId, updatedAt }
		: null;
}

/** The copy as saved, or an empty one when nothing usable is saved or storage is blocked. */
export function readStored(getStorage: StorageGetter): StoredSheet {
	try {
		const raw = getStorage().getItem(SHEET_STORAGE_KEY);
		if (raw === null) return EMPTY_STORED;
		const parsed: unknown = JSON.parse(raw);
		if (!isObject(parsed) || parsed.version !== VERSION) return EMPTY_STORED;
		const sheet = readSheet(parsed.sheet);
		if (sheet === null) return EMPTY_STORED;
		const editedAt = text(parsed.editedAt, 64);
		const sync = readSync(parsed.sync);
		const shelf = Array.isArray(parsed.shelf)
			? parsed.shelf
					.map(readSheet)
					.filter((kept): kept is Sheet => kept !== null)
					.slice(0, SHELF_LIMIT)
			: [];
		return {
			sheet,
			editedAt: editedAt && !Number.isNaN(Date.parse(editedAt)) ? editedAt : null,
			dirty: parsed.dirty === true,
			sync,
			// An ancestor only means something beside the sheet it was synced with.
			base: sync ? readSheet(parsed.base) : null,
			shelf
		};
	} catch {
		return EMPTY_STORED;
	}
}

/** Saves the copy. Storage can be blocked or full, and then the sheet lasts this visit only. */
export function writeStored(getStorage: StorageGetter, stored: StoredSheet): boolean {
	try {
		getStorage().setItem(SHEET_STORAGE_KEY, JSON.stringify({ version: VERSION, ...stored }));
		return true;
	} catch {
		return false;
	}
}
