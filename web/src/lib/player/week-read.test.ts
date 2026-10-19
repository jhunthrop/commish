// The week-ahead read beside the card (Lane 66v): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WeekRead } from '../run/schema.ts';
import { shownWeekRead } from './week-read.ts';

const MOVED = 'The published projection moved since this read was written.';
const READ: WeekRead = {
	week: 7,
	body: 'Josh Allen gets the Jets at home, and the published projection has him at 26.4 points.',
	caption: 'Written Fri 9:00 pm Central, for week 7',
	status: null,
	call: 'start',
	writtenAt: '2026-10-17T02:00:00.000Z',
	factsAt: '2026-10-17T02:00:00.000Z',
	projection: 26.4,
	movedCaption: MOVED
};
const ppr = (points: number | null) => ({ week: 7, scoring: 'ppr' as const, points });

void test('the read stands while the card prints the projection it quotes', () => {
	assert.deepEqual(shownWeekRead(READ, ppr(26.4)), { body: READ.body, caption: READ.caption });
});

void test('the read is withheld once the card prints another projection (the sweep X5: 26.6 against 26.4)', () => {
	assert.deepEqual(shownWeekRead({ ...READ, projection: 26.6 }, ppr(26.4)), {
		body: null,
		caption: MOVED
	});
	assert.deepEqual(shownWeekRead(READ, ppr(null)), { body: null, caption: MOVED });
});

void test('the read stands as built until the card reads in PPR for its week', () => {
	const built = { body: READ.body, caption: READ.caption };
	assert.deepEqual(shownWeekRead(READ, null), built);
	assert.deepEqual(shownWeekRead(READ, { week: 7, scoring: 'half_ppr', points: 22.1 }), built);
	assert.deepEqual(shownWeekRead(READ, { ...ppr(20), week: 8 }), built);
	// A run from before the read carried its figure is not judged.
	const older: WeekRead = { ...READ, projection: undefined, movedCaption: undefined };
	assert.deepEqual(shownWeekRead(older, ppr(20)), built);
});

void test('a read the run already withheld stays withheld', () => {
	const withheld = { ...READ, body: null, caption: MOVED };
	assert.deepEqual(shownWeekRead(withheld, ppr(26.4)), { body: null, caption: MOVED });
});
