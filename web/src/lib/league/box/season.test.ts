// "Rest of season" heads one unit (Lane 66u, sweep X6): his points a game wherever it heads a
// column, a gain headed "Gain" with its basis beside it, the words in one module Trades and Waivers
// both read. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SEASON, TRADE_GAIN, WAIVER_GAIN } from './season.ts';
import { TRADES } from './trades.ts';
import { cardGains, WAIVERS } from './waivers.ts';

void test('the heads come from one module', () => {
	assert.equal(SEASON.restOfSeason, 'Rest of season');
	assert.equal(TRADES.restOfSeason, SEASON.restOfSeason);
	assert.equal(WAIVERS.rest, SEASON.restOfSeason);
	assert.equal(TRADE_GAIN, 'Gain, over replacement a week');
	assert.equal(WAIVER_GAIN, 'Gain a week');
	assert.equal(WAIVERS.gain, WAIVER_GAIN);
	assert.equal(TRADES.gainHead, TRADE_GAIN);
});

void test('"Rest of season" never heads a gain on either screen', () => {
	for (const said of [...Object.values(TRADES), ...Object.values(WAIVERS)]) {
		if (/rest of season/i.test(said)) assert.equal(said, SEASON.restOfSeason, said);
	}
	assert.equal(cardGains({ weekGain: 6.7, gain: 1.2 }), '+6.7 Proj this week, +1.2 Gain a week');
});

void test('a phone, which drops the group heads, says the gain on each side', () => {
	assert.equal(TRADES.yourGain, 'Your gain');
	assert.equal(TRADES.theirGain, 'Their gain');
});
