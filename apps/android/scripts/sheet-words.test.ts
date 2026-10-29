// The Android Sheet's words (Lane 267; Lane 283, B266): the words the web and the phones share are generated
// from web/src/lib/sheet/words.ts and print-words.ts into the Words tables (shared/scripts/gen-words.ts),
// and SheetWords reads them there; a copy of one in SheetWords fails here. What SheetWords still spells
// is a word with a slot (B256), each piece of which is found in the web's sheet sources, or the phone's
// own word, listed below with the reason. Run with `node --test apps/android/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const REPOSITORY = join(import.meta.dirname, '..', '..', '..');
const SOURCE = join(
	REPOSITORY,
	'apps/android/core/src/main/kotlin/app/trycommish/core/sheet/SheetWords.kt'
);
/** Where the web's sheet words live: the sheet's modules and route, and the rail that names the page. */
const WEB = [
	'web/src/lib/sheet',
	'web/src/routes/sheet',
	'web/src/lib/ui/SheetRow.svelte',
	'web/src/lib/ui/nav.ts'
];

/** The phone's own words and the formats that are not words, each with why the web has no such string. */
const PHONE_OWN: Readonly<Record<string, string>> = {
	'America/New_York': 'a zone identifier, not a word',
	'h:mm a': 'a date format, not a word',
	'No connection.': 'the reason an edit did not reach the account; the web has no request to fail',
	'Try again in a minute.': 'the reason when the account answered nothing readable',
	'The file could not be saved on this phone.':
		"the export's file could not be written for the share sheet; the web's browser downloads it",
	'Edit ': "a screen reader's label for the row's disclosure, which the web's row has no need of",
	'No player read, so your sheet is as it was.':
		"the account's sentence for an import that reads no player, which the phone also says for a CSV it reads no player from; the web disables its verb instead",
	'Paste one player to a row, like 1. Puka Nacua':
		"what a list that reads looks like, under an import the account read nothing from and named no row for; the web reads in the browser and names each line",
	'\\\\b([Ll])ine(s?)\\\\b':"a pattern for the account's word for a line, which the phone says as a row"
};

function sources(path: string): string[] {
	const full = join(REPOSITORY, path);
	if (!statSync(full).isDirectory()) return [readFileSync(full, 'utf8')];
	return readdirSync(full).flatMap((name) =>
		/\.(svelte|ts)$/.test(name) || statSync(join(full, name)).isDirectory()
			? sources(join(path, name))
			: []
	);
}

/** A Kotlin literal from the quote at `start`: its fixed pieces, cut at its templates ($name and ${...}),
 * with the pieces of any literal inside a template; and where it ends. */
function scan(code: string, start: number): { pieces: string[]; end: number } {
	const pieces: string[] = [];
	let piece = '';
	let i = start + 1;
	while (i < code.length && code[i] !== '"') {
		if (code[i] === '$' && code[i + 1] === '{') {
			pieces.push(piece);
			piece = '';
			let depth = 1;
			i += 2;
			while (i < code.length && depth > 0) {
				if (code[i] === '"') {
					const inner = scan(code, i);
					pieces.push(...inner.pieces);
					i = inner.end + 1;
					continue;
				}
				if (code[i] === '{') depth += 1;
				if (code[i] === '}') depth -= 1;
				i += 1;
			}
			continue;
		}
		if (code[i] === '$' && /[A-Za-z_]/.test(code[i + 1] ?? '')) {
			pieces.push(piece);
			piece = '';
			i += 1;
			while (i < code.length && /[A-Za-z0-9_]/.test(code[i])) i += 1;
			continue;
		}
		if (code[i] === '\\') {
			piece += code.slice(i, i + 2);
			i += 2;
			continue;
		}
		piece += code[i];
		i += 1;
	}
	pieces.push(piece);
	return { pieces, end: i };
}

/** Each literal's fixed pieces, cut at its templates, from the code (comments and annotations left out). */
export function literals(kotlin: string): string[] {
	const code = kotlin
		.split('\n')
		.filter((line) => !/^\s*(\/\/|\/\*|\*|@)/.test(line))
		.join('\n');
	const pieces: string[] = [];
	for (let i = 0; i < code.length; i += 1) {
		if (code[i] !== '"') continue;
		const literal = scan(code, i);
		pieces.push(...literal.pieces);
		i = literal.end;
	}
	return pieces.filter((piece) => /[A-Za-z]/.test(piece) || PHONE_OWN[piece] !== undefined);
}

/** The web's spelling of a phone piece: "row" back to the web's "line". */
function webSpelling(piece: string): string {
	return piece.replace(/\brows?\b/g, (word) => word.replace('row', 'line')).replace(/\bRow\b/g, 'Line');
}

test('every word the phone prints on the Sheet is the web’s, or listed as the phone’s own', () => {
	const web = WEB.flatMap(sources).join('\n');
	const missing = literals(readFileSync(SOURCE, 'utf8')).filter(
		(piece) =>
			PHONE_OWN[piece] === undefined && !web.includes(piece) && !web.includes(webSpelling(piece))
	);
	assert.deepEqual(missing, []);
});

test('the phone’s own list names only words SheetWords still prints', () => {
	const printed = new Set(literals(readFileSync(SOURCE, 'utf8')));
	assert.deepEqual(
		Object.keys(PHONE_OWN).filter((piece) => !printed.has(piece)),
		[]
	);
});

test('a literal is cut at its templates', () => {
	assert.deepEqual(
		literals('val a = "Our $format board, ${plural(n, "player")} first"\n// "Not this"'),
		['Our ', ' board, ', 'player', ' first']
	);
});

test('the phone’s "row" is the web’s "line"', () => {
	assert.equal(webSpelling('3 rows skipped'), '3 lines skipped');
	assert.equal(webSpelling('Row 4: '), 'Line 4: ');
	assert.equal(webSpelling('an earlier row'), 'an earlier line');
});

/** Every word the generated sheet tables carry (shared/words/sheet*.json, from web/src/lib/sheet). */
function tableWords(): Set<string> {
	const dir = join(REPOSITORY, 'shared/words');
	return new Set(
		readdirSync(dir)
			.filter((name) => /^sheet(-[a-z]+)?\.json$/.test(name))
			.flatMap((name) =>
				Object.entries(JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>)
					.filter(([key]) => key !== 'functions')
					.map(([, word]) => String(word))
			)
	);
}

test('a word the generated sheet tables carry is read from Words, never copied', () => {
	const words = tableWords();
	assert.ok(words.has('Start from our board'));
	assert.deepEqual(
		literals(readFileSync(SOURCE, 'utf8')).filter((piece) => words.has(piece.replaceAll('\\n', '\n'))),
		[]
	);
});
