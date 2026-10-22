// The week a rest of season counts from, said once (Lane 86, the sweep's Z3): the board's first week,
// and while a game of it is played that it counts that week's games left; a player's own first
// game still to play. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	boardRestFrom,
	playerRestFrom,
	playerRestWords,
	restFromWords,
	restSpanWords
} from './rest-from.ts';

void test('a whole week is "from week 7", a partly played one counts its games still to play', () => {
	assert.equal(restFromWords(7, false), 'from week 7');
	assert.equal(restFromWords(6, true), "from week 6's games left");
});

void test("the board's words read the run's first week and whether a game of it is played", () => {
	assert.equal(
		boardRestFrom({ rosFromWeek: 6, rosFromWeekPartial: true }),
		"from week 6's games left"
	);
	assert.equal(boardRestFrom({ rosFromWeek: 7, rosFromWeekPartial: false }), 'from week 7');
	// A run older than the field says the week alone.
	assert.equal(boardRestFrom({ rosFromWeek: 6 }), 'from week 6');
	assert.equal(boardRestFrom({}), null);
});

void test("a player's words are his club's first game still to play, the board's on a run without it", () => {
	const board = { rosFromWeek: 6, rosFromWeekPartial: true };
	assert.equal(playerRestFrom(board, { restFromWeek: 7 }), 7);
	assert.equal(playerRestFrom(board, { restFromWeek: 6 }), 6);
	assert.equal(playerRestFrom({ rosFromWeek: 6 }, {}), 6);
	// No game left: no week to start from.
	assert.equal(playerRestFrom(board, { restFromWeek: null }), null);
	assert.equal(playerRestFrom({}, { restFromWeek: 7 }), null);
});

void test("a player's own words are his week, or that his club has no game left", () => {
	assert.equal(playerRestWords(7), 'from week 7');
	assert.equal(playerRestWords(null), 'with no game left');
});

void test('the rest tile names the weeks it counts, so its figure a game reconciles (Lane 139, C03)', () => {
	// Weeks 7 to 17: the run's last week, though his Still to play lists week 18 too.
	assert.equal(restSpanWords(7), 'weeks 7 to 17');
	assert.equal(restSpanWords(17), 'week 17');
	// A week 18 board counts week 18 alone.
	assert.equal(restSpanWords(18), 'week 18');
	assert.equal(restSpanWords(null), 'with no game left');
});
