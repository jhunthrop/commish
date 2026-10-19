// A league's screens follow its phase (spec 2026-10-16 §3). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leagueScreens } from './tab-list.ts';

const screens = (phase: Parameters<typeof leagueScreens>[0]['phase'], open = true): string[] =>
	leagueScreens({ phase, waivers_open: open });

void test('in season the four screens, in the rail order, the league page apart', () => {
	assert.deepEqual(screens('in_season'), ['start', 'matchup', 'waivers', 'trades']);
});

void test('in the playoffs waivers stay only while the platform runs them', () => {
	assert.deepEqual(screens('playoffs'), ['start', 'matchup', 'waivers', 'trades']);
	assert.deepEqual(screens('playoffs', false), ['start', 'matchup', 'trades']);
});

void test('before the draft and after the season there are no screens', () => {
	assert.deepEqual(screens('pre_draft'), []);
	assert.deepEqual(screens('draft_day'), []);
	assert.deepEqual(screens('offseason'), []);
});
