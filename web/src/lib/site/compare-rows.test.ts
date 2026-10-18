// Compare's two-column stat table (Lane 66n): the card's figures, the better of each row marked, a
// held player's rank as its word and no rank row judged. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PlayerFormat } from '#lib/run/schema.ts';
import { compareRows, type Side } from './compare-rows.ts';

const numbers = (fields: Partial<PlayerFormat>): PlayerFormat => ({
	positionRank: 1,
	ourRank: 1,
	vorRound: 1,
	adp: 2.8,
	gap: 1.8,
	projected: 344.1,
	vor: 164,
	expectedGames: 14.9,
	floor: 241.7,
	median: 344.1,
	ceiling: 446.5,
	tier: 1,
	...fields
});

const NACUA: Side = {
	player: {
		id: '4426515',
		slug: 'puka-nacua',
		name: 'Puka Nacua',
		position: 'WR',
		team: 'LAR',
		headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/4426515.png',
		formats: {},
		seasonSoFar: { games: 3, pointsPerGame: 25.9 },
		lastSeason: { season: 2025, games: 16, pointsPerGame: 23.4 }
	},
	numbers: numbers({}),
	bye: 11
};
const CHASE: Side = {
	player: {
		...NACUA.player,
		id: '4362628',
		slug: 'jamarr-chase',
		name: "Ja'Marr Chase",
		team: 'CIN',
		seasonSoFar: { games: 5, pointsPerGame: 16 },
		lastSeason: { season: 2025, games: 16, pointsPerGame: 19.6 }
	},
	numbers: numbers({
		positionRank: 2,
		ourRank: 2,
		adp: 3.8,
		gap: 1.8,
		projected: 333.2,
		vor: 153.2
	}),
	bye: 6
};

const byLabel = (rows: ReturnType<typeof compareRows>, label: string) => {
	const row = rows.find((candidate) => candidate.label === label);
	if (!row) throw new Error(`No ${label} row.`);
	return row;
};

void test('the table carries the card figures in order, the season rows once it is underway', () => {
	assert.deepEqual(
		compareRows(NACUA, CHASE, 2026, true).map((row) => row.label),
		[
			'Our rank',
			'Position rank',
			'Projected',
			'Over replacement',
			'Floor to ceiling',
			'ADP',
			'Gap',
			'Bye',
			'A game',
			'GP',
			'2025 a game'
		]
	);
	assert.ok(!compareRows(NACUA, CHASE, 2026, false).some((row) => row.label === 'GP'));
});

void test('the better figure wins its row, and the ADP, gap and bye judge no one', () => {
	const rows = compareRows(NACUA, CHASE, 2026, true);
	assert.deepEqual(
		byLabel(rows, 'Our rank').cells.map((cell) => [cell.text, cell.wins]),
		[
			['1', true],
			['2', false]
		]
	);
	assert.deepEqual(
		byLabel(rows, 'Over replacement').cells.map((cell) => cell.text),
		['+164.0', '+153.2']
	);
	// The run's gap, printed as given, toned as the board row tones it, judging no one.
	assert.deepEqual(
		byLabel(rows, 'Gap').cells.map((cell) => [cell.text, cell.wins, cell.tone]),
		[
			['+1.8', null, 'gain'],
			['+1.8', null, 'gain']
		]
	);
	assert.equal(byLabel(rows, 'Position rank').cells[1].text, 'WR 2');
	assert.equal(byLabel(rows, '2025 a game').cells[0].wins, true);
});

void test('a held player shows his rank as the word, and no rank row is judged', () => {
	const held: Side = {
		...CHASE,
		player: {
			...CHASE.player,
			status: { status: 'injured_reserve', seasonLong: true, since: null }
		}
	};
	const rows = compareRows(NACUA, held, 2026, true);
	assert.deepEqual(
		byLabel(rows, 'Our rank').cells.map((cell) => [cell.text, cell.wins]),
		[
			['1', null],
			['IR', null]
		]
	);
	assert.equal(byLabel(rows, 'Position rank').cells[1].text, 'WR IR');
	assert.equal(byLabel(rows, 'Gap').cells[1].text, 'None');
});
