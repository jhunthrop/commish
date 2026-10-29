/** The cheat sheet's parity (Lane 254): what the web's sheet writes and says over a fixture sheet, as
 * JSON the apps' Sheet screens are held to. The CSV the web's export writes for the fixture rows
 * (sheet/csv.ts encodeCsv), which the API's export (api/internal/sheets/csv.go EncodeCSV) is held to
 * byte for byte by its own test, so the file a phone shares is the file the site downloads; the fixed
 * tags with their chips' words and tones, a tag tap on a row's tags (tags.ts toggledTags), why a typed
 * tag is refused (tagProblem) and its stored spelling (canonicalTag); the status line beside the
 * sheet's name for every state the apps draw (status.ts statusWords), at instants and in a zone that
 * read the same on every machine; the sheet's bounds and its first name; and what the web's import reads
 * from a file before it lets it replace a sheet (csv.ts decodeCsv: the header's sentence, the players kept
 * in rank order, each skipped line's reason), which the phone reads before it sends a file. Written by export-parity.ts
 * beside the others. */
import { CsvHeaderError, decodeCsv, encodeCsv } from '../../web/src/lib/sheet/csv.ts';
import { SHEET_LIMITS } from '../../web/src/lib/sheet/limits.ts';
import { SHEET } from '../../web/src/lib/sheet/words.ts';
import type { SheetPlayer, SheetRow } from '../../web/src/lib/sheet/model.ts';
import { looksLikeCsv, nameIndex, readList } from '../../web/src/lib/sheet/paste.ts';
import { statusWords, type StatusFacts } from '../../web/src/lib/sheet/status.ts';
import {
	FIXED_TAGS,
	canonicalTag,
	tagLabel,
	tagProblem,
	tagTone,
	toggledTags
} from '../../web/src/lib/sheet/tags.ts';

export const SHEET_OUTPUT = 'shared/fixtures/parity/sheet.json';

/** The fixture sheet: every cell the CSV quotes or defuses (a comma, a quote, a line break, a lead a
 * spreadsheet runs as a formula), every empty cell, a fixed and an own tag, Avoid's tone, a defense
 * and a kicker. Faces are left out: the file carries none. */
export const SHEET_ROWS: readonly SheetRow[] = [
	row('4362628', "Ja'Marr Chase", 'WR', 'CIN', 1, ['target'], 'Round one, no thinking.'),
	row(
		'4430807',
		'Bijan Robinson',
		'RB',
		'ATL',
		1,
		['sleeper', 'PPR bump'],
		'Says "workhorse", I agree'
	),
	row('4431299', 'Rome Odunze', 'WR', 'CHI', 2, [], 'Two lines.\nSecond line.'),
	row('3139477', 'Patrick Mahomes', 'QB', 'KC', null, ['avoid', 'injury'], '=SUM(A1)'),
	row('4239996', 'Travis Etienne Jr.', 'RB', 'JAX', 3, ['handcuff'], '-3 last week'),
	row('4689114', 'Jaxson Dart', 'QB', 'NYG', null, [], null),
	row('dst-BUF', 'Buffalo Bills', 'DST', 'BUF', null, ['breakout'], '+ upside at home'),
	row('3054850', 'Brandon Aubrey', 'K', null, null, [], '@ the dome')
];

function row(
	id: string,
	name: string,
	position: SheetRow['position'],
	team: string | null,
	tier: number | null,
	tags: readonly string[],
	note: string | null
): SheetRow {
	return { id, name, position, team, headshot: null, tier, tags, note };
}

/** A tag tapped on a row's tags: on, off, in place of its opposite, refused on a full row, and a typed
 * tag in another case or spacing read as the one it spells. */
const TOGGLES: readonly { tags: readonly string[]; tag: string }[] = [
	{ tags: [], tag: 'target' },
	{ tags: ['target'], tag: 'target' },
	{ tags: ['target'], tag: 'avoid' },
	{ tags: ['avoid', 'sleeper'], tag: 'target' },
	{ tags: ['target', 'sleeper', 'breakout', 'injury'], tag: 'handcuff' },
	{ tags: ['target', 'sleeper', 'breakout', 'injury'], tag: 'avoid' },
	{ tags: [], tag: 'TARGET' },
	{ tags: [], tag: '  late   round ' },
	{ tags: ['Late round'], tag: 'late ROUND' },
	{ tags: ['sleeper'], tag: 'Rookie' }
];

/** Typed tags: kept, too long, a lead that is not a letter or digit, a separator, an apostrophe, an
 * accent, and nothing. */
const TYPED = ['ok tag', 'x'.repeat(21), '-late', 'one,two', "Rookie's", 'Élite', '', 'Sleeper'];

/** A change on Oct 13 at noon Eastern and an answer ten days on: no zone reads them as one day, so the
 * saved words name the day wherever this runs (the time of a save today is the reader's own clock, held
 * by the apps' own tests). */
const CHANGED = '2026-10-13T16:00:00.000Z';
const ANSWERED = new Date('2026-10-23T16:00:00.000Z');

const STATUSES: readonly StatusFacts[] = [
	facts('saving', null, CHANGED, 8),
	facts('saved', null, null, 8),
	facts('saved', null, CHANGED, 8),
	facts('failed', 'This sheet changed on another device', CHANGED, 8),
	facts('failed', null, CHANGED, 8),
	facts('failed', 'Some of that did not check out', null, 0),
	facts('saving', null, null, 0),
	facts('saved', null, CHANGED, 0)
];

function facts(
	status: StatusFacts['status'],
	problem: string | null,
	changedAt: string | null,
	players: number
): StatusFacts {
	return { status, problem, changedAt, answeredAt: ANSWERED, players };
}

/** Files an import is given: a pasted list of names, nothing, the fixture's own CSV, a header with no
 * line a player reads from, and one line of each reason a line is skipped beside lines kept out of rank
 * order (a byte order mark, an alias, a defused cell, CRLF, an unterminated quote at the end), and
 * unquoted cells with spaces inside them, which a read keeps (an id and its closed-up twin, a tag one
 * character too long, a position split in two) and only trims at a cell's start. */
const READS: readonly string[] = [
	"1. Puka Nacua\n2. Ja'Marr Chase, WR",
	'',
	"name,team\nJa'Marr Chase,CIN\n",
	encodeCsv(SHEET_ROWS),
	[
		'rank,player_id,name,position,tags',
		'1,a b,Spaced id,QB,',
		'2,ab,Closed id,QB,',
		'3,a b,Spaced twin,RB,',
		'4,c,Long tag,RB,abcdefghij klmnopqrst',
		'5,d,Split position,W R,',
		'6,e,  Lead space,WR,  Late round',
		''
	].join('\n'),
	'rank,player_id,name,position\n0,a,Zero,QB\n1,b,Linebacker,LB\n2,,No id,RB\n',
	[
		'\uFEFFRANK,Player_ID,Name,Position,Tier,Tag,Note,Team\r',
		"3,c,Third,wr,2,sleeper|Rookie,'=1+1,CIN\r",
		'1,a,First,QB,,target;avoid,,\r',
		'2,b,Second,D/ST,51,,,\r',
		'4,d,Fourth,PK,,a|b|c|d|e,,\r',
		'5,e,Fifth,TE,1.5,,,\r',
		'6,c,Again,RB,,,,\r',
		'1.0,f,Sixth,RB,,-bad,,\r',
		'x,g,Seventh,RB,,,,\r',
		'7,h,Eighth,RB,,,,TOOLONGTEAM\r',
		'8,i,Ninth,K,,,,\r',
		'9,j,Tenth,RB,,,"open'
	].join('\n')
];

/** The board a pasted names list is read against (paste.ts readList), which the API's import is held to
 * (api/internal/sheets/paste.go ReadList): two players who share a name, a name with an accent, a
 * suffix and an apostrophe, a defense by name, club, nickname and city, a city two clubs share, a
 * kicker, a free agent. */
export const LIST_BOARD: readonly SheetPlayer[] = [
	listPlayer('4429795', 'Jahmyr Gibbs', 'RB', 'DET'),
	listPlayer('4362628', "Ja'Marr Chase", 'WR', 'CIN'),
	listPlayer('4239996', 'Travis Etienne Jr.', 'RB', 'JAX'),
	listPlayer('3055899', 'Brandon Aubrey', 'K', 'DAL'),
	listPlayer('wr-thomas', 'Michael Thomas', 'WR', 'NO'),
	listPlayer('te-thomas', 'Michael Thomas', 'TE', 'FA'),
	listPlayer('wr-estime', 'Audric Estimé', 'WR', null),
	listPlayer('DST-BUF', 'Buffalo Bills', 'DST', 'BUF'),
	listPlayer('DST-KC', 'Kansas City Chiefs', 'DST', 'KC'),
	listPlayer('DST-LAR', 'Los Angeles Rams', 'DST', 'LAR'),
	listPlayer('DST-LAC', 'Los Angeles Chargers', 'DST', 'LAC'),
	listPlayer('rb-walker', 'Kenneth Walker III', 'RB', 'KC'),
	listPlayer('wr-fitz', 'Larry Fitzgerald Sr.', 'WR', 'ARI'),
	listPlayer('wr-stbrown', 'Amon-Ra St. Brown', 'WR', 'DET'),
	listPlayer('rb-swift', 'D’Andre Swift', 'RB', 'CHI')
];

/** A board of one more player than a sheet holds, and the list naming each in turn: the last line is
 * past the limit. Only the count read and the skipped lines are kept. */
const LIMIT_BOARD: readonly SheetPlayer[] = Array.from(
	{ length: SHEET_LIMITS.rows + 1 },
	(_, k) => listPlayer(`lim-${String(k)}`, `Limit Player ${'x'.repeat(k % 5)}${String(k)}`, 'WR', null)
);

function listPlayer(
	id: string,
	name: string,
	position: SheetPlayer['position'],
	team: string | null
): SheetPlayer {
	return { id, name, position, team, headshot: null };
}

/** Pasted lists: numbering styles, hints, a repeat, an unknown name, a shared name with and without
 * its position, defenses every way, CRLF and blank lines, and a first line that names player_id (a
 * CSV, not a list). */
const LISTS: readonly string[] = [
	"1. Puka Nacua\n2. Ja'Marr Chase, WR",
	"1. Jahmyr Gibbs\r\n\r\n2) ja'marr chase\n3 - Travis Etienne\n4: Brandon Aubrey (PK, DAL)\n  \n5. Jahmyr Gibbs, RB",
	'Michael Thomas\nMichael Thomas, TE\n7. Michael Thomas (WR, NO)\nMichael Thomas, QB',
	'audric estime\nAUDRIC ESTIMÉ, WR',
	'Bills D/ST\nBUF DST\nChiefs\nKC\nBuffalo Defense\nLos Angeles D/ST\nRams D/ST\nLAC DEF\nLos Angeles',
	'Gibbs\nJahmyr',
	'Kenneth Walker III\nlarry fitzgerald sr\nKenneth Walker\nAmon Ra St Brown\namon-ra st. brown, WR',
	'D’Andre Swift\nD\'Andre Swift\nDAndre Swift',
	'1 Jahmyr Gibbs\n2) Brandon Aubrey\n3.  Amon-Ra St. Brown \n4) Bills D/ST\n5) Los Angeles D/ST\nMichael Thomas, TE\nBills DST\n \n﻿7. Jahmyr Gibbs',
	'rank,player_id,name,position\n1,a,B,QB',
	''
];

function listOf(text: string): {
	text: string;
	csv: boolean;
	ids: readonly string[];
	skipped: readonly { line: number; reason: string }[];
} {
	if (looksLikeCsv(text)) return { text, csv: true, ids: [], skipped: [] };
	const read = readList(text, nameIndex(LIST_BOARD));
	return { text, csv: false, ids: read.rows.map((row) => row.id), skipped: read.skipped };
}

function limitRead(): {
	text: string;
	read: number;
	skipped: readonly { line: number; reason: string }[];
} {
	const text = LIMIT_BOARD.map((p) => p.name).join('\n');
	const read = readList(text, nameIndex(LIMIT_BOARD));
	return { text, read: read.rows.length, skipped: read.skipped };
}

function readOf(text: string): {
	text: string;
	header: string | null;
	ids: readonly string[];
	skipped: readonly { line: number; reason: string }[];
} {
	try {
		const read = decodeCsv(text);
		return {
			text,
			header: null,
			ids: read.rows.map((row) => row.id),
			skipped: read.skipped
		};
	} catch (error) {
		if (!(error instanceof CsvHeaderError)) throw error;
		return { text, header: error.message, ids: [], skipped: [] };
	}
}

export function renderSheet(about: string): string {
	const sheet = {
		about,
		defaultName: SHEET.defaultName,
		limits: SHEET_LIMITS,
		rows: SHEET_ROWS,
		csv: encodeCsv(SHEET_ROWS),
		fixedTags: FIXED_TAGS.map(({ tag, label }) => ({
			tag,
			label,
			tone: tagTone(tag)
		})),
		labels: ['target', 'avoid', 'PPR bump'].map((tag) => ({
			tag,
			label: tagLabel(tag),
			tone: tagTone(tag)
		})),
		toggles: TOGGLES.map(({ tags, tag }) => ({
			tags,
			tag,
			after: toggledTags(tags, tag)
		})),
		typed: TYPED.map((tag) => ({
			tag,
			canonical: canonicalTag(tag),
			problem: tagProblem(canonicalTag(tag))
		})),
		answeredAt: ANSWERED.toISOString(),
		statuses: STATUSES.map((status) => ({
			status: status.status,
			problem: status.problem,
			changedAt: status.changedAt,
			players: status.players,
			words: statusWords(status)
		})),
		reads: READS.map(readOf),
		listBoard: LIST_BOARD,
		lists: LISTS.map(listOf),
		limitBoard: LIMIT_BOARD.map((p) => ({ id: p.id, name: p.name, position: p.position })),
		limitList: limitRead()
	};
	return `${JSON.stringify(sheet, null, '\t')}\n`;
}
