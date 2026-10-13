/**
 * How the sheet in this browser and the sheet on your account become one when you sign in, or
 * when a save finds the account's copy changed on another device. The rule never loses a row:
 *
 * 1. If this browser has no edits the account has not seen, the account's sheet is the sheet,
 *    removals made on another device included.
 * 2. Otherwise every player on either sheet is on the merged sheet. The side edited last is the
 *    base: its order, its name and its tiers stand. A player only the other side has goes in
 *    right after the player he followed there (at the top if he led it).
 * 3. A player on both keeps the base side's tier, the base side's tags followed by the other
 *    side's (up to the limit), and the base side's note. When both have a note and they differ,
 *    neither is dropped: the base note, a middle dot, then the other, cut to the note limit.
 * 4. Tiers are then made whole within each position (tiers.ts), so an inserted player joins the
 *    tier of the player above him.
 */
import { SHEET_LIMITS } from './limits.ts';
import type { Sheet, SheetRow } from './model.ts';
import { normalizeTags } from './tags.ts';
import { repairTiers } from './tiers.ts';

export interface MergeSides {
	local: Sheet;
	/** When this browser last edited its sheet, ISO, or null if never. */
	localEditedAt: string | null;
	/** Whether this browser has edits the account has not acknowledged. */
	localDirty: boolean;
	server: Sheet;
	/** The account sheet's updated_at. */
	serverUpdatedAt: string;
}

const NOTE_JOIN = ' · ';

function mergeNote(base: string | null, other: string | null): string | null {
	if (!other || other === base) return base;
	if (!base) return other;
	if (base.includes(other)) return base;
	if (other.includes(base)) return other;
	return `${base}${NOTE_JOIN}${other}`.slice(0, SHEET_LIMITS.note);
}

function mergeRow(base: SheetRow, other: SheetRow): SheetRow {
	return {
		...base,
		headshot: base.headshot ?? other.headshot,
		team: base.team ?? other.team,
		tags: normalizeTags([...base.tags, ...other.tags]),
		note: mergeNote(base.note, other.note)
	};
}

/** The base side's rows, with the other side's own players slotted in after their neighbours. */
function unionRows(base: readonly SheetRow[], other: readonly SheetRow[]): readonly SheetRow[] {
	const otherById = new Map(other.map((row) => [row.id, row]));
	const merged: SheetRow[] = base.map((row) => {
		const twin = otherById.get(row.id);
		return twin ? mergeRow(row, twin) : row;
	});
	const placed = new Set(merged.map((row) => row.id));
	let anchor = -1;
	for (const row of other) {
		if (placed.has(row.id)) {
			anchor = merged.findIndex((candidate) => candidate.id === row.id);
			continue;
		}
		anchor += 1;
		merged.splice(anchor, 0, row);
		placed.add(row.id);
	}
	return merged;
}

function editedLater(localEditedAt: string | null, serverUpdatedAt: string): boolean {
	if (localEditedAt === null) return false;
	return Date.parse(localEditedAt) > Date.parse(serverUpdatedAt);
}

/** The one sheet both sides become. */
export function mergeSheets(sides: MergeSides): Sheet {
	const { local, localDirty, server } = sides;
	if (!localDirty || local.rows.length === 0) return server;
	if (server.rows.length === 0) return { ...local, format: server.format };
	const localIsBase = editedLater(sides.localEditedAt, sides.serverUpdatedAt);
	const base = localIsBase ? local : server;
	const other = localIsBase ? server : local;
	return { ...base, rows: repairTiers(unionRows(base.rows, other.rows)) };
}

/** Whether two sheets would store the same rows, names and annotations alike. */
export function sameSheet(a: Sheet, b: Sheet): boolean {
	if (a.name !== b.name || a.format !== b.format || a.rows.length !== b.rows.length) return false;
	return a.rows.every((row, index) => {
		const twin = b.rows[index];
		return (
			twin?.id === row.id &&
			twin.tier === row.tier &&
			twin.note === row.note &&
			twin.tags.length === row.tags.length &&
			twin.tags.every((tag, k) => tag === row.tags[k])
		);
	});
}
