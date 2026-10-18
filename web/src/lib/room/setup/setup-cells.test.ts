// The setup's settings table (Lane 66o): only what the form below does not show, as cells (review
// M4): the clocks and when a lobby starts. The format, teams, seat and rounds are the form's own.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupCells } from './setup.ts';

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
