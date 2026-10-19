// The player page's and /compare's in-season words: the preseason figure for a player the preseason
// board did not rank, the drafters sentence in season, the every-format table's heading, and the
// compare caption. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bannedPattern } from '#lib/format/copy-guard.ts';
import {
	draftersWords,
	HELD_TIER_WORDS,
	formatTable,
	lineWords,
	restFigures,
	type RestFigures
} from './player-words.ts';
import { restCaption } from './rest-words.ts';
import type { Format, PlayerFormat } from './schema.ts';

const PPR: Format = {
	id: 'ppr-12',
	label: 'PPR',
	unit: 'PPR pts',
	teams: 12,
	basis: ['PPR, full 2026 season']
};
const REST: Format = {
	...PPR,
	basis: ['PPR, rest of the 2026 season from week 7, refreshed October 21'],
	rosFromWeek: 7,
	rosThroughWeek: 6,
	refreshedAt: '2026-10-21T12:00:00.000Z'
};
const BARE: PlayerFormat = {
	positionRank: 3,
	ourRank: 12,
	vorRound: 1,
	adp: 15,
	gap: 3,
	projected: 140,
	vor: 40,
	expectedGames: 9.5,
	floor: null,
	median: null,
	ceiling: null,
	tier: 2
};
const NUMBERS: PlayerFormat = { ...BARE, preseasonRank: 20, preseasonPoints: 250 };
const REACH = { scoring: 'PPR', through: 6 };

void test('in season his preseason rank and points sit beside the rest of the season', () => {
	const rest = restFigures(REST, NUMBERS, REACH, 2026);
	assert.ok(rest);
	assert.deepEqual(rest.preseason, { rank: 20, points: 250 });
	assert.match(
		rest.lead,
		/^Ranked by points over replacement for the rest of the 2026 season from week 7/
	);
});

void test('a player off the preseason board has no preseason figure, never a zero', () => {
	const rest = restFigures(
		REST,
		{ ...NUMBERS, preseasonRank: null, preseasonPoints: null },
		REACH,
		2026
	);
	assert.equal(rest?.preseason, null);
});

void test('an in-season row without its preseason fields is refused, and a preseason board has none', () => {
	assert.throws(() => restFigures(REST, BARE, REACH, 2026), /without his preseason figures/);
	assert.equal(restFigures(PPR, BARE, REACH, 2026), null);
});

void test('in season the drafters sentence gives the ADP alone, as a fact of the drafts before the season', () => {
	assert.equal(
		draftersWords(NUMBERS, ['PPR drafts, Sep 9'], true),
		'His ADP in PPR drafts, Sep 9, before the season.'
	);
	assert.equal(
		draftersWords({ ...NUMBERS, adp: null }, [], true),
		'None of our ADP sources has him.'
	);
	assert.match(
		draftersWords(NUMBERS, ['PPR drafts, Sep 9'], false),
		/^We have him at pick 12, so drafters take him 3.0 picks later\./
	);
});

void test("the drafters sentence reads the run's gap as given, and names none where the run wrote none", () => {
	assert.equal(
		draftersWords({ ...NUMBERS, adp: 5.5, ourRank: 10, gap: -4.5 }, ['PPR drafts'], false),
		'We have him at pick 10, so drafters take him 4.5 picks earlier. ADP 5.5 from PPR drafts.'
	);
	assert.equal(
		draftersWords({ ...NUMBERS, gap: undefined }, ['PPR drafts'], false),
		'We have him at pick 12. ADP 15.0 from PPR drafts.'
	);
});

void test('the every-format table names the in-season basis in its heading, or beside each line when mixed', () => {
	const rest: RestFigures = { lead: 'x', preseason: null };
	const half: Format = { ...REST, id: 'half-ppr-12', label: 'Half PPR' };
	assert.deepEqual(
		formatTable([
			{ format: REST, rest },
			{ format: half, rest }
		]),
		{
			head: 'Rest of season from week 7',
			labels: ['PPR', 'Half PPR']
		}
	);
	assert.deepEqual(formatTable([{ format: PPR, rest: null }]), {
		head: 'Projected',
		labels: ['PPR']
	});
	assert.deepEqual(
		formatTable([
			{ format: REST, rest },
			{ format: { ...PPR, id: 'standard-12', label: 'Standard' }, rest: null }
		]),
		{
			head: 'Projected',
			labels: ['PPR, rest of season from week 7', 'Standard']
		}
	);
});

void test('/compare captions the in-season figure with the rest of the season and the refresh, never games', () => {
	assert.equal(
		restCaption(REST, 2026),
		'PPR points for the rest of the 2026 season from week 7, refreshed October 21'
	);
	assert.equal(restCaption(PPR, 2026), null);
});

const SOURCES = ['PPR drafts, Sep 5 to Sep 9'];
const SEASON = { year: 2026, underway: true };

void test('before the run ranks the rest of the season the facts frame him by pick and round', () => {
	const words = lineWords({ format: PPR, numbers: BARE, rest: null }, SOURCES, 618, SEASON);
	assert.equal(words.draftersLabel, 'Where drafters take him');
	assert.equal(words.draftersFigure, 'Pick 15');
	assert.equal(words.value, 'Round 1 value among the 618 on our board');
});

void test('in season the ADP is a fact and the rest-of-season rank takes the round and the pick', () => {
	const rest = restFigures(REST, NUMBERS, REACH, 2026);
	const words = lineWords({ format: REST, numbers: NUMBERS, rest }, SOURCES, 618, SEASON);
	assert.equal(words.draftersLabel, 'ADP');
	assert.equal(words.draftersFigure, '15.0');
	assert.equal(words.drafters, 'His ADP in PPR drafts, Sep 5 to Sep 9, before the season.');
	assert.equal(words.value, 'Our rank 12 of the 618 on our board for the rest of the season');
	assert.doesNotMatch(`${words.value} ${words.drafters} ${words.draftersLabel}`, /round|pick/i);
	const below = lineWords(
		{ format: REST, numbers: { ...NUMBERS, vor: -4 }, rest },
		SOURCES,
		618,
		SEASON
	);
	assert.equal(
		below.value,
		'Below replacement for the rest of the season, among the 618 on our board'
	);
	const none = lineWords(
		{ format: REST, numbers: { ...NUMBERS, adp: null }, rest },
		[],
		618,
		SEASON
	);
	assert.equal(none.draftersFigure, 'No ADP');
});

void test('a player on a season-long list is never given a rank as if he plays (Lane 63)', () => {
	const rest = restFigures(REST, NUMBERS, REACH, 2026);
	const held = { ...SEASON, heldOut: true };
	const words = lineWords({ format: REST, numbers: NUMBERS, rest }, SOURCES, 618, held);
	assert.equal(
		words.caption,
		'PPR points for the rest of 2026 if he plays, below the available players'
	);
	assert.equal(
		words.value,
		'If he plays, among the 618 on our board for the rest of the season. He sits below the available players.'
	);
	assert.equal(
		words.drafters,
		'ADP 15.0 from PPR drafts, Sep 5 to Sep 9. He sits below the available players.'
	);
	const preseason = lineWords({ format: PPR, numbers: BARE, rest: null }, SOURCES, 618, held);
	assert.equal(
		preseason.drafters,
		'ADP 15.0 from PPR drafts, Sep 5 to Sep 9. He sits below the available players.'
	);
	assert.deepEqual([preseason.draftersLabel, preseason.draftersFigure], ['ADP', '15.0']);
	assert.equal(
		preseason.value,
		'If he plays, among the 618 on our board. He sits below the available players.'
	);
	for (const line of [words.caption, words.value, preseason.value, preseason.drafters]) {
		assert.doesNotMatch(line, /rank \d|Round \d|pick \d|picks/u, line);
		assert.doesNotMatch(line, bannedPattern(), line);
	}
});

void test('a held player is placed in no tier: his aside says why (Lane 63, N1)', () => {
	assert.match(HELD_TIER_WORDS, /^No tier while he is on a season-long list\./u);
	assert.doesNotMatch(HELD_TIER_WORDS, /Tier \d|rank \d/u);
	assert.doesNotMatch(HELD_TIER_WORDS, bannedPattern());
});
