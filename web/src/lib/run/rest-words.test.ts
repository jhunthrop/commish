// The in-season words: the board's lead from the switch week, and the range a board carries. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { carriesRange, rangeScale } from './derive.ts';
import { restLead } from './rest-words.ts';
import type { Format } from './schema.ts';

const PPR: Format = {
	id: 'ppr-12',
	label: 'PPR',
	unit: 'PPR pts',
	teams: 12,
	basis: ['PPR, full 2026 season']
};
const REST: Format = {
	...PPR,
	basis: ['PPR, rest of the 2026 season from week 6, refreshed October 14'],
	rosFromWeek: 6,
	rosThroughWeek: 5,
	refreshedAt: '2026-10-14T19:05:38.329Z'
};

void test('from the switch week the lead names the rest of the season, the refresh day and the figures', () => {
	assert.equal(
		restLead(REST, { scoring: 'PPR', through: 5 }, 2026),
		"Ranked by points over replacement for the rest of the 2026 season from week 6, refreshed October 14. Games and points a game are this season's, through week 5."
	);
});

void test('on a board of another scoring the figures name theirs', () => {
	const half: Format = { ...REST, id: 'half-ppr-12', label: 'Half PPR' };
	assert.equal(
		restLead(half, { scoring: 'PPR', through: 5 }, 2026),
		"Ranked by points over replacement for the rest of the 2026 season from week 6, refreshed October 14. Games and points a game are this season's, scored in PPR, through week 5."
	);
});

void test('the refresh day is the day on the Eastern clock', () => {
	const late: Format = { ...REST, refreshedAt: '2026-10-15T03:30:00.000Z' };
	assert.match(
		restLead(late, { scoring: 'PPR', through: 5 }, 2026) ?? '',
		/refreshed October 14\./
	);
});

void test('a preseason board has no rest-of-season lead', () => {
	assert.equal(restLead(PPR, { scoring: 'PPR', through: 5 }, 2026), null);
});

void test('in season the rows carry no range and the scale is one step drawn by no bar', () => {
	const rest = [{ floor: null, ceiling: null }];
	assert.equal(carriesRange(rest), false);
	assert.deepEqual(rangeScale(rest), { lo: 0, hi: 25 });
	const preseason = [
		{ floor: 60, ceiling: 140 },
		{ floor: 30, ceiling: 90 }
	];
	assert.equal(carriesRange(preseason), true);
	assert.deepEqual(rangeScale(preseason), { lo: 25, hi: 140 });
});
