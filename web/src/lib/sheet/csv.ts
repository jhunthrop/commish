/**
 * The sheet as a CSV, the same file the API writes and reads (api/internal/sheets/csv.go):
 *
 *   rank,player_id,name,position,team,tier,tags,note
 *
 * One player per line in rank order. tier is his tier within his position. tags holds up to four
 * tags separated by commas (bars and semicolons read too). A header named tag reads as tags. A cell
 * a spreadsheet would run as a formula is written with a leading apostrophe, which a read takes off.
 * A read needs rank, player_id, name and position in any order and case, skips a bad line with
 * its reason, and orders what it keeps by rank.
 */
import { SHEET_LIMITS, characterCount } from './limits.ts';
import { parsePosition, type SheetRow } from './model.ts';
import { SHEET_IMPORT } from './words.ts';
import {
	canonicalTag,
	joinTagCell,
	normalizeTags,
	sameTag,
	splitTagCell,
	tagProblem
} from './tags.ts';

export const CSV_COLUMNS = [
	'rank',
	'player_id',
	'name',
	'position',
	'team',
	'tier',
	'tags',
	'note'
] as const;
type Column = (typeof CSV_COLUMNS)[number];
const REQUIRED: readonly Column[] = ['rank', 'player_id', 'name', 'position'];
const ALIASES: Readonly<Record<string, Column>> = { tag: 'tags' };

/** The largest file a read takes, the API's limit. */
export const CSV_MAX_BYTES = 1 << 20;

const BYTE_ORDER_MARK = '﻿';
const FORMULA_LEAD = '=+-@\t\r';

function defuse(value: string): string {
	return value !== '' && FORMULA_LEAD.includes(value.charAt(0)) ? `'${value}` : value;
}

function undefuse(value: string): string {
	return value.length > 1 && value.startsWith("'") && FORMULA_LEAD.includes(value.charAt(1))
		? value.slice(1)
		: value;
}

function quote(value: string): string {
	const needs = /[",\r\n]/.test(value) || value.startsWith(' ') || value.startsWith('\t');
	return needs ? `"${value.replaceAll('"', '""')}"` : value;
}

/** The sheet as the CSV file, header first. */
export function encodeCsv(rows: readonly SheetRow[]): string {
	const lines = rows.map((row, index) =>
		[
			String(index + 1),
			defuse(row.id),
			defuse(row.name),
			defuse(row.position),
			defuse(row.team ?? ''),
			row.tier === null ? '' : String(row.tier),
			defuse(joinTagCell(row.tags)),
			defuse(row.note ?? '')
		]
			.map(quote)
			.join(',')
	);
	return [CSV_COLUMNS.join(','), ...lines].map((line) => `${line}\n`).join('');
}

/** Records of an RFC 4180 file. A quote left open runs to the end and is reported. */
function parseRecords(text: string): { records: string[][]; unterminated: boolean } {
	const records: string[][] = [];
	let record: string[] = [];
	let field = '';
	let quoted = false;
	let fieldStart = true;
	const endField = (): void => {
		record.push(field);
		field = '';
		fieldStart = true;
	};
	for (let i = 0; i < text.length; i += 1) {
		const char = text.charAt(i);
		if (quoted) {
			if (char === '"' && text.charAt(i + 1) === '"') {
				field += '"';
				i += 1;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
		} else if (char === '"' && fieldStart) {
			quoted = true;
			fieldStart = false;
		} else if (char === ',') {
			endField();
		} else if (char === '\n' || char === '\r') {
			if (char === '\r' && text.charAt(i + 1) === '\n') i += 1;
			endField();
			if (!(record.length === 1 && record[0] === '')) records.push(record);
			record = [];
		} else if ((char === ' ' || char === '\t') && fieldStart && field === '') {
			// A read trims leading space, as the API's does.
		} else {
			field += char;
			fieldStart = false;
		}
	}
	if (field !== '' || record.length > 0) {
		endField();
		records.push(record);
	}
	return { records, unterminated: quoted };
}

export interface CsvSkip {
	/** The record's number in the file, the header being 1. */
	line: number;
	reason: string;
}

export interface CsvRead {
	rows: readonly SheetRow[];
	skipped: readonly CsvSkip[];
}

export class CsvHeaderError extends Error {}

type ColumnIndex = Partial<Record<Column, number>>;

function headerIndex(header: readonly string[]): ColumnIndex {
	const index: ColumnIndex = {};
	header.forEach((raw, i) => {
		const name = raw.replace(BYTE_ORDER_MARK, '').trim().toLowerCase();
		const column = ALIASES[name] ?? CSV_COLUMNS.find((known) => known === name);
		if (column !== undefined && index[column] === undefined) index[column] = i;
	});
	const missing = REQUIRED.filter((column) => index[column] === undefined);
	if (missing.length > 0) {
		throw new CsvHeaderError('The first line must name rank, player_id, name and position');
	}
	return index;
}

function cell(record: readonly string[], index: ColumnIndex, column: Column): string {
	const at = index[column];
	return at === undefined ? '' : undefuse((record[at] ?? '').trim());
}

function lengthProblem(label: string, value: string, min: number, max: number): string | null {
	const length = characterCount(value);
	return length < min || length > max ? `The ${label} runs ${min} to ${max} characters` : null;
}

function readTags(raw: string): { tags: readonly string[] } | { reason: string } {
	const tags: string[] = [];
	for (const piece of splitTagCell(raw)) {
		const tag = canonicalTag(piece);
		const problem = tagProblem(tag);
		if (problem) return { reason: problem };
		if (!tags.some((kept) => sameTag(kept, tag))) tags.push(tag);
	}
	if (tags.length > SHEET_LIMITS.tags) return { reason: `Keep it to ${SHEET_LIMITS.tags} tags` };
	// Target and Avoid never sit on one player. The line says which, rather than keep one quietly.
	const kept = normalizeTags(tags);
	if (kept.length < tags.length) return { reason: SHEET_IMPORT.bothTargetAndAvoid };
	return { tags: kept };
}

type Read = { rank: number; row: SheetRow } | { reason: string };

function readRecord(record: readonly string[], index: ColumnIndex): Read {
	const rank = Number(cell(record, index, 'rank'));
	if (!Number.isInteger(rank) || rank < 1) return { reason: SHEET_IMPORT.badRank };
	const id = cell(record, index, 'player_id');
	const name = cell(record, index, 'name');
	const team = cell(record, index, 'team');
	const note = cell(record, index, 'note');
	const problem =
		lengthProblem('player_id', id, 1, SHEET_LIMITS.playerId) ??
		lengthProblem('name', name, 1, SHEET_LIMITS.playerName) ??
		lengthProblem('team', team, 0, SHEET_LIMITS.team) ??
		lengthProblem('note', note, 0, SHEET_LIMITS.note);
	if (problem) return { reason: problem };
	const position = parsePosition(cell(record, index, 'position'));
	if (position === null) return { reason: SHEET_IMPORT.badPosition };
	const rawTier = cell(record, index, 'tier');
	const tier = rawTier === '' ? null : Number(rawTier);
	if (tier !== null && (!Number.isInteger(tier) || tier < 1 || tier > SHEET_LIMITS.tier)) {
		return { reason: `The tier is not a whole number from 1 to ${SHEET_LIMITS.tier}` };
	}
	const tags = readTags(cell(record, index, 'tags'));
	if ('reason' in tags) return tags;
	return {
		rank,
		row: {
			id,
			name,
			position,
			team: team === '' ? null : team,
			headshot: null,
			tier,
			tags: tags.tags,
			note: note === '' ? null : note
		}
	};
}

/** Reads a CSV in the sheet's shape. Throws CsvHeaderError when the header cannot be used. */
export function decodeCsv(text: string): CsvRead {
	const { records, unterminated } = parseRecords(text);
	const [header, ...body] = records;
	if (!header) throw new CsvHeaderError(SHEET_IMPORT.emptyFile);
	const index = headerIndex(header);
	const kept: { rank: number; line: number; row: SheetRow }[] = [];
	const skipped: CsvSkip[] = [];
	const seen = new Set<string>();
	body.forEach((record, k) => {
		const line = k + 2;
		const isLast = k === body.length - 1;
		if (unterminated && isLast) {
			skipped.push({ line, reason: 'This line is not valid CSV' });
			return;
		}
		const read = readRecord(record, index);
		if ('reason' in read) skipped.push({ line, reason: read.reason });
		else if (seen.has(read.row.id))
			skipped.push({ line, reason: 'This player is already on an earlier line' });
		else if (kept.length >= SHEET_LIMITS.rows)
			skipped.push({ line, reason: `A sheet holds at most ${SHEET_LIMITS.rows} players` });
		else {
			seen.add(read.row.id);
			kept.push({ ...read, line });
		}
	});
	kept.sort((a, b) => a.rank - b.rank || a.line - b.line);
	return { rows: kept.map((entry) => entry.row), skipped };
}

/** The file name an export downloads as. */
export function csvFileName(sheetName: string): string {
	const slug = sheetName
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	return `${slug === '' ? 'sheet' : slug}.csv`;
}
