// The solo room's pick header as cells (Lane 66o review M5), where a dotted line once said the round,
// the league, the slot and the next pick. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LeagueSettings } from './api.ts';
import { pickBarCells } from './words.ts';

const settings = {
	scoring: { preset: 'ppr', custom: null },
	teams: 12,
	slot: 8,
	roster: { qb: 1, rb: 2, wr: 2, te: 1, k: 1, dst: 1, bench: 6 },
	lineup: 'standard',
	keepers: [],
	bot_style: 'adp'
} as LeagueSettings;

void test('the pick header says round, teams, scoring, slot, your next pick and picks away as cells', () => {
	assert.deepEqual(
		pickBarCells(settings, 8, { now: 56, round: 5, next: 65 }).map((c) => [c.label, c.value]),
		[
			['Round', '5'],
			['Teams', '12'],
			['Scoring', 'PPR'],
			['Slot', '8'],
			['Your next', '6.05'],
			['Picks away', '8']
		]
	);
});

void test('a superflex league names its lineup, and the last pick has no next', () => {
	const cells = pickBarCells({ ...settings, lineup: 'superflex' }, 8, {
		now: 176,
		round: 15,
		next: null
	});
	assert.deepEqual(
		cells.map((c) => c.label),
		['Round', 'Teams', 'Scoring', 'Lineup', 'Slot']
	);
	assert.equal(cells.find((c) => c.label === 'Lineup')?.value, 'superflex');
});
