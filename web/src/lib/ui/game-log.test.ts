// The game log's week ahead (Lane 80): the run's state stands until the page reads the API's, which
// takes its place, so no week shows two states at once. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stillToPlay, type AheadRow, type LogNext } from './game-log.ts';

const ahead: AheadRow[] = [
	{ week: 6, opponent: 'at LV', bye: false, day: 'Kicked off' },
	{ week: 7, opponent: 'Bye', bye: true, day: '' },
	{ week: 8, opponent: 'vs BAL', bye: false, day: 'Sun Nov 1' }
];
const next: LogNext = {
	week: 6,
	opponent: 'at LV',
	when: 'Final',
	proj: '21.8',
	expected: null,
	weather: null
};

void test("the run's weeks still to play until the read, then the read's week in their place", () => {
	assert.deepEqual(stillToPlay(ahead, null), ahead);
	assert.deepEqual(
		stillToPlay(ahead, next).map((row) => row.week),
		[7, 8]
	);
	// A read for a week the run has not reached leaves the run's weeks as they are.
	assert.deepEqual(stillToPlay(ahead, { ...next, week: 5 }), ahead);
});
