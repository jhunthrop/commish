// The iOS Sheet's words held to the web's (Lane 254, until B266 lifts the web's sheet words into a module
// gen-words carries): every string literal in SheetWords.swift, cut at its interpolations, is found in the
// web's sheet sources, or is listed below as the phone's own with the reason. A web wording change fails
// here until the phone follows. Run with `node --test apps/ios/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const REPOSITORY = join(import.meta.dirname, '..', '..', '..');
const SWIFT = join(
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
		'a file the phone read no player from is not sent; the web disables its verb instead',
	'No player read. Your sheet is shown as your account now holds it.':
		"the account's import replaced the rows with none (B265); the web never sends such a file"
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
	const missing = literals(readFileSync(SWIFT, 'utf8')).filter(
		(piece) => PHONE_OWN[piece] === undefined && !web.includes(piece)
	);
	assert.deepEqual(missing, []);
});

test('the phone’s own list names only words SheetWords still prints', () => {
	const printed = new Set(literals(readFileSync(SWIFT, 'utf8')));
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
