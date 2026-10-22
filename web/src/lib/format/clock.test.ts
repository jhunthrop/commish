// The player page's one stamp format and a kickoff's zone (Lane 139, C11, C12). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kickoffAt, stampAt, zoneShort } from './clock.ts';

const CENTRAL = 'America/Chicago';

void test('a stamp says its weekday, its date and its zone, as the nightly caption does', () => {
	assert.equal(stampAt('2026-10-21T16:12:00.000Z', CENTRAL), 'Wed Oct 21, 11:12 am CT');
	assert.equal(stampAt('2026-12-01T06:30:00.000Z', CENTRAL), 'Tue Dec 1, 12:30 am CT');
	assert.equal(stampAt('2026-10-21T16:12:00.000Z', 'America/New_York'), 'Wed Oct 21, 12:12 pm ET');
});

void test('a kickoff says its zone, the same name in summer and winter', () => {
	assert.equal(kickoffAt('2026-10-25T20:25:00.000Z', CENTRAL), 'Sun 3:25 pm CT');
	assert.equal(
		zoneShort('2026-07-01T12:00:00.000Z', CENTRAL),
		zoneShort('2026-12-01T12:00:00.000Z', CENTRAL)
	);
});
