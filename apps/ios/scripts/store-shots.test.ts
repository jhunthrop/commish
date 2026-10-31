/** The App Store screenshots' check: the committed files pass it, and the names the store run reads apply. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkShots, EXPECTED, readNamePairs, renamed, STEMS } from './store-shots.ts';

test('the committed App Store screenshots are each the size App Store Connect takes, none with alpha', () => {
	assert.deepEqual(checkShots(), []);
});

test('the listing needs the eight shots at both iPhone sizes', () => {
	assert.equal(EXPECTED.length, STEMS.length * 2);
	assert.deepEqual(
		EXPECTED.filter((e) => e.file.startsWith('large-')).map((e) => [e.width, e.height]),
		STEMS.map(() => [1320, 2868])
	);
	assert.deepEqual(
		EXPECTED.filter((e) => e.file.startsWith('medium-')).map((e) => [e.width, e.height]),
		STEMS.map(() => [1206, 2622])
	);
});

test('the shared store names replace the recorded league, the league read as ESPN', () => {
	const pairs = readNamePairs();
	assert.equal(renamed('"name": "Muttdogs", "host": "ffpc"', pairs), '"name": "Two Minute Drill", "host": "espn"');
	assert.equal(renamed('"Patrick Mahomes"', pairs), '"Patrick Mahomes"', 'player names stay');
});
