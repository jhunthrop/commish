// The setup's settings table (Lane 66o): only what the form below does not show, as cells (review
// M4): the clocks and when a lobby starts. The format, teams, seat and rounds are the form's own.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bannedIn } from '#lib/format/copy-guard.ts';
import { lobbyFillWords, setupCells } from './setup.ts';

void test('the setup strip says the clocks and when a lobby starts, nothing the form shows', () => {
	assert.deepEqual(
		setupCells({ clock_seconds: 30 }).map((c) => [c.label, c.value]),
		[
			['Clock against bots', 'None'],
			['Clock in a lobby', '30 s a pick'],
			['A lobby starts', 'Full, or 90 s after the first join']
		]
	);
});

void test('before the lobbies are read the lobby clock is left out', () => {
	assert.deepEqual(
		setupCells(undefined).map((c) => c.label),
		['Clock against bots', 'A lobby starts']
	);
});

void test('a lobby card says the people in, never a scoreline against its seats', () => {
	assert.deepEqual(lobbyFillWords(0), { words: 'No one in yet', empty: true });
	assert.deepEqual(lobbyFillWords(1), { words: '1 in', empty: false });
	assert.deepEqual(lobbyFillWords(3), { words: '3 in', empty: false });
	for (const n of [0, 1, 3, 12]) {
		const { words } = lobbyFillWords(n);
		assert.doesNotMatch(words, /\bof\b/);
		assert.equal(bannedIn(words), null);
	}
});

void test('the lobby list draws the count from its one function', () => {
	const list = readFileSync(new URL('./LobbyList.svelte', import.meta.url), 'utf8');
	assert.match(list, /lobbyFillWords\(/);
	assert.doesNotMatch(list, /\{lobby\.filling\} of/);
});
