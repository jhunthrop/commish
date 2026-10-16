// A league's tabs follow its phase (spec 2026-10-16 §3). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leagueScreens, leagueTabs } from './tab-list.ts';

const labels = (phase: Parameters<typeof leagueTabs>[0]['phase'], open = true): string[] =>
	leagueTabs({ phase, waivers_open: open }).map((tab) => tab.label);

void test('in season the league page and the four screens, by their rail words', () => {
	assert.deepEqual(labels('in_season'), ['League', 'Lineup', 'Matchup', 'Waivers', 'Trades']);
	assert.deepEqual(leagueScreens({ phase: 'in_season', waivers_open: true }), [
		'start',
		'matchup',
		'waivers',
		'trades'
	]);
});

void test('in the playoffs waivers stay only while the host runs them', () => {
	assert.deepEqual(labels('playoffs'), ['League', 'Lineup', 'Matchup', 'Trades', 'Waivers']);
	assert.deepEqual(labels('playoffs', false), ['League', 'Lineup', 'Matchup', 'Trades']);
});

void test('before the draft and after the season there are no tabs', () => {
	assert.deepEqual(labels('pre_draft'), []);
	assert.deepEqual(labels('draft_day'), []);
	assert.deepEqual(labels('offseason'), []);
});
