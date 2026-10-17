// The player a player page's verb sends to a league screen (Lane 66h): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASKED_PARAM, askedPlayer } from './asked.ts';

void test('a league screen reads the asked player from its address', () => {
	assert.equal(ASKED_PARAM, 'player');
	assert.equal(
		askedPlayer('https://x.test/league/l1/waivers?player=4426515&position=WR'),
		'4426515'
	);
	assert.equal(askedPlayer('https://x.test/league/l1/start'), null);
});
