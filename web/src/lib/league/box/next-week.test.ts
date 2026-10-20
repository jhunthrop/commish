// The week an action screen addresses (Lane 95): the API's for_week, the Proj figures drawn once its
// projection is read, and the day it arrives before that. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import {
	addressedWeek,
	arrivesPart,
	carriedMark,
	NEXT_WEEK,
	turnedPage,
	weekProjected
} from './next-week.ts';
import { weekHeadFor } from './trades.ts';
import { statusOf } from './box.ts';

const ZONE = 'America/Chicago';
/** Week 7's first capture: two hours before Thursday's 7:15 pm Central kickoff. */
const THURSDAY_SLOT = '2026-10-22T22:15:00.000Z';

void test("the page's week is the API's for_week, the platform's week on an older answer", () => {
	assert.equal(addressedWeek({ week: 6, for_week: 7 }), 7);
	assert.equal(addressedWeek({ week: 6 }), 6);
});

void test('a listing carried over from a played game says its date, never hidden (Lane 95 ruling)', () => {
	const out = {
		status: 'out' as const,
		as_of: '2026-10-20T00:00:00.000Z',
		since: null,
		listed: '2026-10-12T17:00:00.000Z',
		carried_over: true
	};
	assert.equal(carriedMark(out, ZONE), 'Out, listed Oct 12');
	assert.equal(carriedMark({ ...out, listed: null }, ZONE), 'Out, as of Oct 19');
	assert.equal(carriedMark({ ...out, carried_over: undefined }, ZONE), null);
	assert.equal(carriedMark(null, ZONE), null);
	// Every row that draws a status draws it so.
	assert.equal(statusOf(out, false, ZONE)?.mark, 'Out, listed Oct 12');
	assert.equal(statusOf({ ...out, carried_over: undefined }, false, ZONE)?.mark, 'Out');
	for (const said of [NEXT_WEEK.listed('Out', 'Oct 12'), NEXT_WEEK.asOf('Out', 'Oct 19')])
		assert.doesNotMatch(said, bannedPattern());
});

void test('a turned page names its week in the week group head', () => {
	assert.equal(turnedPage({ week: 6, for_week: 7 }), true);
	assert.equal(turnedPage({ week: 6 }), false);
	assert.equal(weekHeadFor({ week: 6, for_week: 7 }), 'Week 7, Proj');
	assert.equal(weekHeadFor({ week: 6, for_week: 6 }), 'This week, Proj');
});

void test('the week Proj figures are drawn once the projection is read', () => {
	assert.equal(weekProjected({ projection_read_at: null }), false);
	assert.equal(weekProjected({ projection_read_at: '2026-10-19T23:00:00.000Z' }), true);
});

void test('before the projection is read, the day it arrives on the member clock', () => {
	const said = arrivesPart(
		{ projection_read_at: null, projection_arrives_at: THURSDAY_SLOT },
		7,
		ZONE
	);
	assert.equal(said, 'Week 7 projections expected Thursday.');
	assert.doesNotMatch(said, bannedPattern());
	assert.equal(
		arrivesPart(
			{ projection_read_at: '2026-10-22T23:00:00.000Z', projection_arrives_at: THURSDAY_SLOT },
			7,
			ZONE
		),
		null
	);
	// An answer from before the field, or one with no time to say, says nothing of it.
	assert.equal(arrivesPart({ projection_read_at: null }, 7, ZONE), null);
	assert.equal(
		arrivesPart({ projection_read_at: null, projection_arrives_at: null }, 7, ZONE),
		null
	);
});
