/**
 * Your sheet: your order of players, each with the tier you set within his position, your tags and
 * a note. Every function here returns a new sheet and never edits the one it is given, so the store
 * can keep the previous one for undo and the sync can compare the two.
 */
import type { components } from '#lib/api/types.ts';
import { POSITIONS, type Position } from '#lib/types/player.ts';
import { DEFAULT_SHEET_NAME, SHEET_LIMITS } from './limits.ts';
import { normalizeTags } from './tags.ts';
import { repairTiers } from './tiers.ts';

export type BoardFormat = components['schemas']['BoardFormat'];

/** Who a player is, as the row keeps him: what the drafter saw when he added him. */
export interface SheetPlayer {
	id: string;
	name: string;
	position: Position;
	team: string | null;
	headshot: string | null;
}

export interface SheetRow extends SheetPlayer {
	/** His tier within his position, 1 the top, or null while that position has no tiers. */
	tier: number | null;
	tags: readonly string[];
	note: string | null;
}

export interface Sheet {
	name: string;
	format: BoardFormat;
	/** Best first. */
	rows: readonly SheetRow[];
}

export const DEFAULT_FORMAT: BoardFormat = 'ppr';

export function emptySheet(format: BoardFormat = DEFAULT_FORMAT): Sheet {
	return { name: DEFAULT_SHEET_NAME, format, rows: [] };
}

/** A position as the API or a file spells it, read into ours. */
const POSITION_ALIASES: Readonly<Record<string, Position>> = {
	DEF: 'DST',
	'D/ST': 'DST',
	DST: 'DST',
	PK: 'K'
};

export function parsePosition(raw: string): Position | null {
	const upper = raw.trim().toUpperCase();
	const alias = POSITION_ALIASES[upper];
	if (alias) return alias;
	return POSITIONS.find((position) => position === upper) ?? null;
}

export function rowFor(player: SheetPlayer): SheetRow {
	return { ...player, tier: null, tags: [], note: null };
}

export function indexOfPlayer(sheet: Sheet, playerId: string): number {
	return sheet.rows.findIndex((row) => row.id === playerId);
}

export function hasPlayer(sheet: Sheet, playerId: string): boolean {
	return indexOfPlayer(sheet, playerId) !== -1;
}

function withRows(sheet: Sheet, rows: readonly SheetRow[]): Sheet {
	return { ...sheet, rows: repairTiers(rows) };
}

/** The sheet with him at the bottom, or the same sheet when he is on it or it is full. */
export function addPlayer(sheet: Sheet, player: SheetPlayer): Sheet {
	if (hasPlayer(sheet, player.id) || sheet.rows.length >= SHEET_LIMITS.rows) return sheet;
	return withRows(sheet, [...sheet.rows, rowFor(player)]);
}

export function removePlayer(sheet: Sheet, playerId: string): Sheet {
	if (!hasPlayer(sheet, playerId)) return sheet;
	return withRows(
		sheet,
		sheet.rows.filter((row) => row.id !== playerId)
	);
}

/**
 * Moves a player to a place in the whole order, 0-based and clamped. In a position with tiers he
 * joins the tier of the player of his position just above him, or just below him when he lands
 * first, or the one `tierFrom` names when the drop says which side of a tier strip he landed on.
 */
export function movePlayer(
	sheet: Sheet,
	playerId: string,
	to: number,
	tierFrom: 'above' | 'below' = 'above'
): Sheet {
	const from = indexOfPlayer(sheet, playerId);
	if (from === -1) return sheet;
	const target = Math.max(0, Math.min(sheet.rows.length - 1, to));
	const moving = sheet.rows[from];
	if (!moving || (target === from && moving.tier === null)) return sheet;
	const rest = sheet.rows.filter((row) => row.id !== playerId);
	const tier = landingTier(rest, target, moving, tierFrom);
	const rows = [...rest.slice(0, target), { ...moving, tier }, ...rest.slice(target)];
	return withRows(sheet, rows);
}

function landingTier(
	rest: readonly SheetRow[],
	at: number,
	moving: SheetRow,
	side: 'above' | 'below'
): number | null {
	if (moving.tier === null) return null;
	const samePosition = (row: SheetRow): boolean => row.position === moving.position;
	const above = rest.slice(0, at).findLast(samePosition);
	const below = rest.slice(at).find(samePosition);
	const first = side === 'above' ? (above ?? below) : (below ?? above);
	return first?.tier ?? moving.tier;
}

/** Moves a player by `delta` places among the rows a view shows, the keyboard's arrows. */
export function nudgePlayer(
	sheet: Sheet,
	playerId: string,
	delta: number,
	visible: readonly string[]
): Sheet {
	const at = visible.indexOf(playerId);
	if (at === -1 || delta === 0) return sheet;
	const neighbourAt = Math.max(0, Math.min(visible.length - 1, at + delta));
	const neighbour = visible[neighbourAt];
	if (neighbour === undefined || neighbour === playerId) return sheet;
	const to = indexOfPlayer(sheet, neighbour);
	return movePlayer(sheet, playerId, to, delta < 0 ? 'below' : 'above');
}

function updateRow(sheet: Sheet, playerId: string, change: (row: SheetRow) => SheetRow): Sheet {
	if (!hasPlayer(sheet, playerId)) return sheet;
	return { ...sheet, rows: sheet.rows.map((row) => (row.id === playerId ? change(row) : row)) };
}

/** Sets his note, or clears it with an empty one. */
export function setNote(sheet: Sheet, playerId: string, note: string): Sheet {
	const trimmed = note.trim().slice(0, SHEET_LIMITS.note);
	return updateRow(sheet, playerId, (row) => ({ ...row, note: trimmed === '' ? null : trimmed }));
}

export function setTags(sheet: Sheet, playerId: string, tags: readonly string[]): Sheet {
	return updateRow(sheet, playerId, (row) => ({ ...row, tags: normalizeTags(tags) }));
}

export function renameSheet(sheet: Sheet, name: string): Sheet {
	const trimmed = name.trim().slice(0, SHEET_LIMITS.sheetName);
	return trimmed === '' ? sheet : { ...sheet, name: trimmed };
}

/** Replaces every row, the way an import or a saved draft does. */
export function replaceRows(sheet: Sheet, rows: readonly SheetRow[]): Sheet {
	return withRows(sheet, rows.slice(0, SHEET_LIMITS.rows));
}

/** His rank in the whole order and within his position, 1-based, by id. */
export interface Ranks {
	overall: number;
	position: number;
}

export function ranksOf(rows: readonly SheetRow[]): ReadonlyMap<string, Ranks> {
	const counts = new Map<Position, number>();
	const out = new Map<string, Ranks>();
	rows.forEach((row, index) => {
		const position = (counts.get(row.position) ?? 0) + 1;
		counts.set(row.position, position);
		out.set(row.id, { overall: index + 1, position });
	});
	return out;
}
