// "A game" heads one unit (Lane 66u, 66t, sweep X6): his rest-of-season points a game wherever it
// heads a column, as the order's, a gain headed "Gain" with its basis beside it, the words in one module Trades and Waivers
// both read. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEASON, TRADE_GAIN, WAIVER_GAIN } from './season.ts';
import { TRADES } from './trades.ts';
import { cardGains, WAIVERS } from './waivers.ts';
import { ORDER } from '#lib/order/words.ts';

void test('the heads come from one module', () => {
	assert.equal(SEASON.perGame, ORDER.perGame);
	assert.equal(TRADES.perGame, SEASON.perGame);
	assert.equal(WAIVERS.rest, SEASON.perGame);
	assert.equal(TRADE_GAIN, 'Gain, over repl. a week');
	assert.equal(WAIVER_GAIN, 'Gain a week');
	assert.equal(WAIVERS.gain, WAIVER_GAIN);
	assert.equal(TRADES.gainHead, TRADE_GAIN);
});

void test('"A game" never heads a gain on either screen, and the card says Gain a week', () => {
	for (const said of [...Object.values(TRADES), ...Object.values(WAIVERS)]) {
		if (/a game/i.test(said)) assert.equal(said, SEASON.perGame, said);
	}
	assert.equal(TRADES.aWeekForYou, 'Gain a week for you');
	assert.equal(cardGains({ weekGain: 6.7, gain: 1.2 }), '+6.7 Proj this week, +1.2 Gain a week');
});

void test('a phone, which drops the group heads, says the gain on each side', () => {
	assert.equal(TRADES.yourGain, 'Your gain');
	assert.equal(TRADES.theirGain, 'Their gain');
});
