// The iOS Sheet's words (Lane 254; Lane 283, B266): the words the web and the phones share are generated
// from web/src/lib/sheet/words.ts and print-words.ts into the Words tables (shared/scripts/gen-words.ts),
// and SheetWords reads them there; a copy of one in SheetWords fails here. What SheetWords still spells
// is a word with a slot (B256), each piece of which is found in the web's sheet sources, or the phone's
// own word, listed below with the reason. Run with `node --test apps/ios/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const REPOSITORY = join(import.meta.dirname, '..', '..', '..');
const SOURCE = join(
	REPOSITORY,
	'apps/ios/Packages/CommishCore/Sources/CommishCore/CheatSheet/SheetWords.swift'
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
	en_US_POSIX: 'a locale identifier, not a word',
	'h:mm a': 'a date format, not a word',
	'No connection.': 'the reason an edit did not reach the account; the web has no request to fail',
	'Try again in a minute.': 'the reason when the account answered nothing readable',
	'Edit ': "a screen reader's label for the row's disclosure, which the web's row has no need of",
	'No player read, so your sheet is as it was.':
		"the account's sentence for an import that reads no player, which the phone also says for a CSV it reads no player from; the web disables its verb instead",
	'Paste one player to a row, like 1. Puka Nacua':
		"what a list that reads looks like, under an import the account read nothing from; its refusal names no row, and the web reads in the browser and names each line",
	'\\b[L]ine(s?)\\b':"a pattern for the account's word for a line, which the phone says as a row",
	'\\b[l]ine(s?)\\b': "a pattern for the account's word for a line, which the phone says as a row",
	Row$1: 'the replacement for that pattern, not a word on its own',
	row$1: 'the replacement for that pattern, not a word on its own'
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

/** A Swift literal from the quote at `start`: its fixed pieces, cut at its interpolations, with the
 * pieces of any literal inside an interpolation; and where it ends. */
function scan(code: string, start: number): { pieces: string[]; end: number } {
	const pieces: string[] = [];
	let piece = '';
	let i = start + 1;
	while (i < code.length && code[i] !== '"') {
		if (code[i] === '\\' && code[i + 1] === '(') {
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
				if (code[i] === '(') depth += 1;
				if (code[i] === ')') depth -= 1;
				i += 1;
			}
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

/** Each literal's fixed pieces, cut at its interpolations, from the code (comments left out). */
export function literals(swift: string): string[] {
	const code = swift
		.split('\n')
		.filter((line) => !line.trim().startsWith('//'))
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

test('every word the phone prints on the Sheet is the web’s, or listed as the phone’s own', () => {
	const web = WEB.flatMap(sources).join('\n');
	const missing = literals(readFileSync(SOURCE, 'utf8')).filter(
		(piece) => PHONE_OWN[piece] === undefined && !web.includes(piece)
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

test('a literal is cut at its interpolations', () => {
	assert.deepEqual(
		literals('let a = "Our \\(format) board, \\(plural(n, "player")) first"\n// "Not this"'),
		['Our ', ' board, ', 'player', ' first']
	);
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
