// The player page's and /compare's in-season words: the preseason figure for a player the preseason
// board did not rank, the drafters sentence in season, the every-format table's heading, and the
// compare caption. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftersWords, formatTable, restFigures, type RestFigures } from './player-words.ts';
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

void test('in season the drafters sentence gives the ADP alone', () => {
	assert.equal(
		draftersWords(NUMBERS, ['PPR drafts, Sep 9'], true),
		'ADP 15.0 from PPR drafts, Sep 9.'
	);
	assert.equal(
		draftersWords({ ...NUMBERS, adp: null }, [], true),
		'None of our ADP sources has him.'
	);
	assert.match(
		draftersWords(NUMBERS, ['PPR drafts, Sep 9'], false),
		/^We have him at pick 12, so drafters take him 3 picks later\./
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
