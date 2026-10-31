/** The App Store screenshots' check: the committed files pass it, and the names the store run reads apply. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sceneProblemsOf } from '../../../shared/store/scene-strings.ts';
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

test('the shared store names replace the recorded league, its host kept as the API spells one', () => {
	const pairs = readNamePairs();
	assert.equal(renamed('"name": "Muttdogs", "host": "ffpc"', pairs), '"name": "Two Minute Drill", "host": "espn"');
	assert.equal(renamed('"Patrick Mahomes"', pairs), '"Patrick Mahomes"', 'player names stay');
});

test("the shared store names turn the API's own sentences that name a platform into your league (Lane 310)", () => {
	const pairs = readNamePairs();
	assert.equal(
		renamed('"reason": "Sleeper does not take trade proposals from here, so we copy the trade for you to propose there."', pairs),
		'"reason": "Your league does not take trade proposals from here, so we copy the trade for you to propose there."'
	);
});

test('every shot has its scene strings, and none names a platform (Lane 310)', () => {
	assert.deepEqual(
		checkShots().filter((p) => p.startsWith('scene-strings/')),
		[]
	);
	assert.deepEqual(sceneProblemsOf('3-trades', ['Open trades in your league']), []);
	assert.deepEqual(sceneProblemsOf('3-trades', ['Open ESPN trades']), ['scene-strings/3-trades.json: "Open ESPN trades" names ESPN']);
});
