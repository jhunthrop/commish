// The player page's "built from" lines as the server builds them (Lane 142 budget trim; Lane 143,
// B126): each format's, from that format's own line, and none where the page draws no list. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Format, PlayerFormat } from '#lib/run/schema.ts';
import { unwrittenLines } from '#lib/run/unwritten-words.ts';
import { unwrittenByFormat, type UnwrittenSource } from './player-unwritten.ts';

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
const PPR = { id: 'ppr-12', label: 'PPR', unit: 'PPR pts' } as Format;
const HALF = { id: 'half-12', label: 'Half PPR', unit: 'Half PPR pts' } as Format;
const HALF_NUMBERS: PlayerFormat = { ...NUMBERS, ourRank: 14, projected: 120, adp: null };
type Line = UnwrittenSource['lines'][number];
const REST = {} as NonNullable<Line['rest']>;

/** A preseason page with no written read, two formats ranking him, the second on a rest-of-season
 * board. */
const SOURCE: UnwrittenSource = {
	lines: [
		{ format: PPR, numbers: NUMBERS, boardSize: 480, rest: null },
		{ format: HALF, numbers: HALF_NUMBERS, boardSize: 450, rest: REST }
	],
	position: 'WR',
	year: 2026,
	held: null,
	underway: false,
	written: false
};

/** The lines as the page's script built them before the trim: from the lead's own line. */
function clientBuilt(line: Line, source: UnwrittenSource): ReturnType<typeof unwrittenLines> {
	return unwrittenLines({
		position: source.position,
		numbers: line.numbers,
		boardSize: line.boardSize,
		label: line.format.label,
		unit: line.format.unit,
		year: source.year,
		restOfSeason: line.rest !== null,
		held: source.held
	});
}

void test("each format's lines are built from that format's own line, keyed by its id", () => {
	const built = unwrittenByFormat(SOURCE);
	assert.deepEqual(Object.keys(built), ['ppr-12', 'half-12']);
	for (const line of SOURCE.lines)
		assert.deepEqual(built[line.format.id], clientBuilt(line, SOURCE));
	// The two formats' lines differ where their lines do: the label, the board, the span.
	assert.notDeepEqual(built['ppr-12'], built['half-12']);
	const half = (built['half-12'] ?? []).map((line) => line.text).join(' ');
	assert.match(half, /the rest of 2026/u);
	assert.doesNotMatch((built['ppr-12'] ?? []).map((line) => line.text).join(' '), /the rest of/u);
});

void test('a held player is placed by the word his ranks show, never the figure that assumes he plays', () => {
	const held = { ...SOURCE, held: 'IR' };
	const built = unwrittenByFormat(held);
	for (const line of held.lines) assert.deepEqual(built[line.format.id], clientBuilt(line, held));
	assert.notDeepEqual(built, unwrittenByFormat(SOURCE));
});

void test('no lines once the season is under way or his read is written', () => {
	assert.deepEqual(unwrittenByFormat({ ...SOURCE, underway: true }), {});
	assert.deepEqual(unwrittenByFormat({ ...SOURCE, written: true }), {});
});
