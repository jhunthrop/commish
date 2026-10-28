// The week-ahead read beside the card (Lane 66v, Lane 158): run with `npm test`. The engine's cases
// at fixed clocks (kicked off, final, moved before kickoff) are in week-words.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WeekRead } from '../run/schema.ts';
import { CARD } from './card.ts';
import { noReadWords, shownWeekRead, weekReadLabel, type ReadGameState } from './week-read.ts';

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
const ppr = (points: number | null, state: ReadGameState = 'upcoming') => ({
	week: 7,
	scoring: 'ppr' as const,
	points,
	state
});
const BUILT = { withheld: false, body: READ.body, caption: READ.caption };

void test('the read is named by the week it was written for, never the week ahead (Lane 95)', () => {
	assert.equal(weekReadLabel(READ), 'Our read for week 7');
	assert.equal(weekReadLabel({ week: 6 }), 'Our read for week 6');
});

void test('the read stands while the card prints the projection it quotes', () => {
	assert.deepEqual(shownWeekRead(READ, ppr(26.4)), BUILT);
});

void test("before kickoff the read is withheld once the projection moves by the tile's 0.5: its caption alone", () => {
	for (const card of [26.9, 25.9, 27.0]) {
		assert.deepEqual(
			shownWeekRead(READ, ppr(card)),
			{ withheld: true, words: MOVED },
			String(card)
		);
	}
	// A move the Proj change tile calls "under 0.5" shows the read (Lane 162, D04).
	for (const card of [26.8, 26.0, 26.5])
		assert.deepEqual(shownWeekRead(READ, ppr(card)), BUILT, String(card));
	assert.deepEqual(shownWeekRead(READ, ppr(null)), { withheld: true, words: MOVED });
	// A bye or a week with no game held is judged as before kickoff.
	assert.deepEqual(shownWeekRead(READ, ppr(20, null)), { withheld: true, words: MOVED });
});

void test('from kickoff through final the read stands whatever the card prints (Lane 158)', () => {
	for (const state of ['kicked_off', 'final'] as const) {
		assert.deepEqual(shownWeekRead(READ, ppr(4.6, state)), BUILT, state);
		assert.deepEqual(shownWeekRead(READ, ppr(null, state)), BUILT, state);
	}
});

void test('the read stands as built until the card reads in PPR for its week', () => {
	assert.deepEqual(shownWeekRead(READ, null), BUILT);
	assert.deepEqual(
		shownWeekRead(READ, { week: 7, scoring: 'half_ppr', points: 22.1, state: 'upcoming' }),
		BUILT
	);
	assert.deepEqual(shownWeekRead(READ, { ...ppr(20), week: 8 }), BUILT);
	// A run from before the read carried its figure is not judged.
	const older: WeekRead = { ...READ, projection: undefined, movedCaption: undefined };
	assert.deepEqual(shownWeekRead(older, ppr(20)), BUILT);
});

void test('a read the run withheld for his status keeps its due time alone while his game is to come', () => {
	const status =
		'His status changed since this read was written. A new read is due by Sat 9:00 am Central.';
	const withheld = { ...READ, body: null, caption: status };
	for (const state of ['upcoming', null] as const)
		assert.deepEqual(shownWeekRead(withheld, ppr(25.1, state)), { withheld: true, words: status });
	assert.deepEqual(shownWeekRead(withheld, null), { withheld: true, words: status });
});

void test('from kickoff through final a withheld read says it was not written, never the passed due time (Lane 160)', () => {
	const status =
		'His status changed since this read was written. A new read is due by Sat 9:00 am Central.';
	const withheld = { ...READ, body: null, caption: status };
	for (const state of ['kicked_off', 'final'] as const) {
		assert.deepEqual(shownWeekRead(withheld, ppr(25.1, state)), {
			withheld: true,
			words: CARD.readNotWritten
		});
		// Another week's game says nothing of this read's.
		assert.deepEqual(shownWeekRead(withheld, { ...ppr(25.1, state), week: 8 }), {
			withheld: true,
			words: status
		});
	}
});

void test('a read the run already withheld stays withheld', () => {
	const withheld = { ...READ, body: null, caption: MOVED };
	assert.deepEqual(shownWeekRead(withheld, ppr(26.4)), { withheld: true, words: MOVED });
});

void test('with no read the place names his next game only while it is still to come', () => {
	assert.equal(noReadWords('upcoming', null), CARD.readNotYet);
	assert.equal(noReadWords(null, null), CARD.readNotYet);
	assert.equal(noReadWords('kicked_off', null), CARD.readNotWritten);
	assert.equal(noReadWords('final', null), CARD.readNotWritten);
});

void test('until the week rolls over the place says the night its reads are written', () => {
	// Lane 256: the run names the week and the night, never "not written yet".
	const due = { week: 8, night: 'Tuesday' } as const;
	assert.equal(noReadWords('upcoming', due), 'Our reads for week 8 are written Tuesday night.');
	assert.equal(noReadWords(null, due), CARD.readsDue(8, 'Tuesday'));
	// A game under way says no read was written for it, whatever the run names.
	assert.equal(noReadWords('kicked_off', due), CARD.readNotWritten);
});
