/**
 * The paste box. It takes either the sheet's CSV (any text whose first line names player_id) or a
 * list of players, one per line, in your order, the way people copy a ranking out of anywhere:
 *
 *   1. Puka Nacua
 *   Ja'Marr Chase, WR
 *   Bijan Robinson (RB, ATL)
 *
 * A name is matched to a player on our board only when it is unmistakable: the same name once
 * case, periods, apostrophes, hyphens and a Jr., Sr. or numeral suffix are set aside, and, when two
 * players share it, the position given on the line. Anything else is reported by line, never
 * guessed, because attaching one man's row to another is the one mistake an import cannot make.
 */
import type { Position } from '#lib/types/player.ts';
import { decodeCsv, type CsvRead, type CsvSkip } from './csv.ts';
import { SHEET_LIMITS } from './limits.ts';
import { parsePosition, rowFor, type SheetPlayer, type SheetRow } from './model.ts';

const LEADING_RANK = /^\s*\d+\s*[.)\-:]?\s+/;
const SUFFIX = /\s+(jr|sr|ii|iii|iv|v)$/;
const HINT_SPLIT = /[,(/|\t]/;

/** A name as matching reads it. */
export function nameKey(name: string): string {
	return name
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[.'’`]/g, '')
		.replace(/-/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(SUFFIX, '');
}

/** The players a pasted list is matched against, by name key. */
export type NameIndex = ReadonlyMap<string, readonly SheetPlayer[]>;

export function nameIndex(players: readonly SheetPlayer[]): NameIndex {
	const index = new Map<string, SheetPlayer[]>();
	for (const player of players) {
		const key = nameKey(player.name);
		index.set(key, [...(index.get(key) ?? []), player]);
	}
	return index;
}

export function looksLikeCsv(text: string): boolean {
	const firstLine = text.trimStart().split(/\r?\n/, 1)[0] ?? '';
	return firstLine.toLowerCase().includes('player_id');
}

interface ListLine {
	name: string;
	position: Position | null;
}

function readListLine(line: string): ListLine {
	const withoutRank = line.replace(LEADING_RANK, '');
	const [namePart = '', ...hints] = withoutRank.split(HINT_SPLIT);
	const position =
		hints
			.flatMap((hint) => hint.replace(/[()]/g, ' ').split(/\s+/))
			.map(parsePosition)
			.find((found) => found !== null) ?? null;
	return { name: namePart.trim(), position };
}

function matchLine(line: ListLine, index: NameIndex): SheetPlayer | string {
	const candidates = index.get(nameKey(line.name)) ?? [];
	const fitting =
		line.position === null
			? candidates
			: candidates.filter((player) => player.position === line.position);
	if (fitting.length === 1 && fitting[0]) return fitting[0];
	if (fitting.length > 1) return 'Two players share this name. Add his position after a comma';
	return 'No player on our board has this name';
}

/** A pasted list read against our board, in the order pasted. */
export function readList(text: string, index: NameIndex): CsvRead {
	const rows: SheetRow[] = [];
	const skipped: CsvSkip[] = [];
	const seen = new Set<string>();
	text.split(/\r?\n/).forEach((raw, k) => {
		const line = k + 1;
		if (raw.trim() === '') return;
		const match = matchLine(readListLine(raw), index);
		if (typeof match === 'string') skipped.push({ line, reason: match });
		else if (seen.has(match.id))
			skipped.push({ line, reason: 'This player is already on an earlier line' });
		else if (rows.length >= SHEET_LIMITS.rows)
			skipped.push({ line, reason: `A sheet holds at most ${SHEET_LIMITS.rows} players` });
		else {
			seen.add(match.id);
			rows.push(rowFor(match));
		}
	});
	return { rows, skipped };
}

/** Whatever was pasted, read: the CSV when it is one, a list against our board otherwise. A list
 * needs the board, so `index` is null until it has loaded and a list then waits for it. */
export function readPaste(text: string, index: NameIndex | null): CsvRead | 'needs-board' {
	if (looksLikeCsv(text)) return decodeCsv(text);
	return index === null ? 'needs-board' : readList(text, index);
}
