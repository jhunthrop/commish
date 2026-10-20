// The week an action screen addresses (Lane 95): the API's for_week, the Proj figures drawn once its
// projection is read, and the day it arrives before that. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import { addressedWeek, arrivesPart, weekProjected } from './next-week.ts';

const ZONE = 'America/Chicago';
/** Week 7's first capture: two hours before Thursday's 7:15 pm Central kickoff. */
const THURSDAY_SLOT = '2026-10-22T22:15:00.000Z';

void test("the page's week is the API's for_week, the platform's week on an older answer", () => {
	assert.equal(addressedWeek({ week: 6, for_week: 7 }), 7);
	assert.equal(addressedWeek({ week: 6 }), 6);
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
	assert.equal(said, 'Week 7 projections arrive Thursday.');
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
