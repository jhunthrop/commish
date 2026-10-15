// The words of a player page whose written read is not ready: the one sentence, and the list of
// what the read will be built from. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlayerFormat } from './schema.ts';
import { UNWRITTEN_READ, unwrittenLines, type UnwrittenInput } from './unwritten-words.ts';

const NUMBERS: PlayerFormat = {
	positionRank: 3,
	ourRank: 12,
	vorRound: 1,
	adp: 15,
	projected: 140,
	vor: 40,
	expectedGames: 15.5,
	floor: 90,
	median: 130,
	ceiling: 180,
	tier: 2
};
const INPUT: UnwrittenInput = {
	position: 'WR',
	numbers: NUMBERS,
	boardSize: 480,
	label: 'PPR',
	unit: 'PPR pts',
	year: 2026,
	restOfSeason: false
};

void test('the page says once that the read is coming, in its own words', () => {
	assert.equal(
		UNWRITTEN_READ,
		'Our written read of him is not ready. Here is what it will be built from.'
	);
});

void test('every row has a lead, a figure and a sentence that names its basis', () => {
	const lines = unwrittenLines(INPUT);
	assert.deepEqual(
		lines.map((l) => l.lead),
		['Our rank', 'His tier', 'His range', 'Games we expect']
	);
	for (const line of lines) {
		assert.notEqual(line.figure, '');
		assert.match(line.text, /PPR/);
		assert.match(line.text, /\.$/);
	}
	const of = (lead: string) => lines.find((line) => line.lead === lead);
	assert.equal(of('Our rank')?.figure, 'WR3');
	assert.match(of('Our rank')?.text ?? '', /pick 12 overall among the 480 on our PPR board/);
	assert.equal(of('His range')?.figure, '90.0 to 180.0');
});

void test('in season the range and the games are the rest of the season, and no range means no row', () => {
	const lines = unwrittenLines({
		...INPUT,
		restOfSeason: true,
		numbers: { ...NUMBERS, floor: null, median: null, ceiling: null }
	});
	assert.deepEqual(
		lines.map((l) => l.lead),
		['Our rank', 'His tier', 'Games we expect']
	);
	assert.match(lines.at(-1)?.text ?? '', /the rest of 2026/);
});

void test('the copy has no em-dash, no semicolon and no trading words', () => {
	for (const line of unwrittenLines(INPUT)) {
		for (const words of [line.lead, line.text, line.figure, UNWRITTEN_READ]) {
			assert.doesNotMatch(words, /[—–;]/, words);
			assert.doesNotMatch(words, /\b(market|price|buy|sell|value)\b/i, words);
		}
	}
});
