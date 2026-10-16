// A listed player's row, page and record words (Lane 63): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	BUILT_ZONE,
	HELD_OUT_METHOD,
	boardStatusWords,
	playerStatusWords,
	recordStatusWords,
	statusView,
	weekNote,
	type Saying
} from './status-view.ts';

const LISTED = '2026-10-16T14:05:00.000Z';
const CENTRAL: Saying = {
	capture: { readAt: LISTED, checkedAt: '2026-10-16T15:05:00.000Z' },
	restOfSeason: true,
	zone: 'America/Chicago',
	now: Date.parse('2026-10-16T16:00:00.000Z')
};

void test('a season-long status shows as his rank and says why he sits below', () => {
	assert.deepEqual(
		statusView(
			{ status: 'injured_reserve', seasonLong: true, since: '2026-10-14T15:00:00.000Z' },
			CENTRAL
		),
		{
			rank: 'IR',
			mark: 'On injured reserve',
			sits: true,
			line: 'On injured reserve since October 14. Our rest-of-season figure assumes he plays, so he sits below the available players.'
		}
	);
});

void test('a week’s designation keeps his rank and carries a mark dated by the list', () => {
	assert.deepEqual(statusView({ status: 'doubtful', seasonLong: false, since: null }, CENTRAL), {
		rank: null,
		mark: 'Doubtful as of Oct 16',
		sits: false,
		line: null
	});
	assert.equal(statusView({ status: 'out', seasonLong: false, since: null }, CENTRAL).sits, true);
	assert.equal(
		weekNote('doubtful'),
		'Doubtful on the latest report, which does not move his place on our board.'
	);
});

void test('the record says the frozen boards it grades moved no one', () => {
	assert.match(HELD_OUT_METHOD, /as it froze, before that move\.$/u);
	assert.doesNotMatch(HELD_OUT_METHOD, /[—;]/u);
	assert.equal(recordStatusWords(CENTRAL).endsWith(HELD_OUT_METHOD), true);
});

void test('a board and a page built on the Eastern clock and said again on the member’s', () => {
	const rows = [
		{ id: 'ir', status: { status: 'injured_reserve', seasonLong: true, since: null } as const },
		{ id: 'free' }
	];
	const built = boardStatusWords(rows, { ...CENTRAL, zone: BUILT_ZONE });
	assert.equal(
		built.capture,
		'Injury status from the hourly capture, read Fri Oct 16, 11:05 am Eastern.'
	);
	assert.deepEqual(Object.keys(built.rows), ['ir']);
	assert.equal(boardStatusWords(rows, CENTRAL).capture.endsWith('10:05 am Central.'), true);
	assert.equal(
		playerStatusWords({ status: 'doubtful', seasonLong: false, since: null }, CENTRAL).note,
		'Doubtful on the latest report, which does not move his place on our board. Injury status from the hourly capture, read Fri Oct 16, 10:05 am Central.'
	);
});
