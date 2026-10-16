// A listed player's row and page words (Lane 63): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HELD_OUT_METHOD, statusView, weekNote } from './status-view.ts';

const READ = '2026-10-16T14:05:00.000Z';
const CENTRAL = 'America/Chicago';

test('a season-long status shows as his rank and says why he sits below', () => {
	assert.deepEqual(
		statusView(
			{ status: 'injured_reserve', seasonLong: true, since: '2026-10-14T15:00:00.000Z' },
			READ,
			true,
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

test('a week’s designation keeps his rank and carries the league screens’ mark', () => {
	assert.deepEqual(
		statusView({ status: 'doubtful', seasonLong: false, since: null }, READ, true, CENTRAL),
		{
			rank: null,
			mark: 'Doubtful as of Fri 9:05 am',
			sits: false,
			line: null
		}
	);
	assert.equal(
		statusView({ status: 'out', seasonLong: false, since: null }, READ, true, CENTRAL).sits,
		true
	);
	assert.equal(
		weekNote('doubtful'),
		'Doubtful this week, which does not move his place on our board.'
	);
});

test('the record says the frozen boards it grades moved no one', () => {
	assert.match(HELD_OUT_METHOD, /as it froze, before that move\.$/u);
	assert.doesNotMatch(HELD_OUT_METHOD, /[—;]/u);
});
