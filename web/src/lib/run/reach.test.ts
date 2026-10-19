// How far a screen's "through week" reaches (Lane 80, the sweep's M2 and Y2): the last complete week,
// with the games of the next week the run already has final named by their day ("week 6's Thursday
// game"), so the basis never claims a week a Sunday player's counts do not reach. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reachOf, reachWords, playedThroughWords, type Reach } from './reach.ts';
import type { GameLogRow } from './season.ts';

const row = (week: number, status: GameLogRow['status']): Pick<GameLogRow, 'week' | 'status'> => ({
	week,
	status
});
type State = 'upcoming' | 'kicked_off' | 'final';
const game = (week: number, opponent: string, kickoff: string, state?: State) => ({
	week,
	opponent,
	kickoff,
	...(state === undefined ? {} : { state })
});
const THURSDAY = '2026-10-16T00:15:00.000Z';
const SUNDAY = '2026-10-18T17:00:00.000Z';
const SATURDAY = '2026-12-19T21:30:00.000Z';
const slates = (thursday: State, sunday: State) => [
	{ abbr: 'SEA', games: [game(6, 'DEN', THURSDAY, thursday)] },
	{ abbr: 'DEN', games: [game(6, 'SEA', THURSDAY, thursday)] },
	{ abbr: 'BUF', games: [game(6, 'MIA', SUNDAY, sunday)] },
	{ abbr: 'MIA', games: [game(6, 'BUF', SUNDAY, sunday)] }
];
const thursdayPlayer = { through: 5, log: [row(5, 'played'), row(6, 'played')] };
const sundayPlayer = { through: 5, log: [row(5, 'played'), row(6, 'upcoming')] };

void test('the Monday after: week 5, and week 6 by the day of its one final game', () => {
	const reach = reachOf([sundayPlayer, thursdayPlayer], slates('final', 'kicked_off'), 5);
	assert.deepEqual(reach, { complete: 5, partial: { week: 6, days: ['Thursday'], games: 1 } });
	assert.equal(reachWords(reach), "through week 5 and week 6's Thursday game");
	assert.equal(playedThroughWords(reach), "weeks 1 to 5 and week 6's Thursday game are played");
});

void test('the Tuesday after, every game in: the week is complete and named alone', () => {
	const reach: Reach = { complete: 6, partial: null };
	assert.equal(reachWords(reach), 'through week 6');
	assert.equal(playedThroughWords(reach), 'weeks 1 to 6 are played');
	assert.equal(playedThroughWords({ complete: 1, partial: null }), 'week 1 is played');
});

void test('two days of a late week, and a first week with only its Thursday in', () => {
	const late = [
		{ abbr: 'KC', games: [game(16, 'DEN', THURSDAY, 'final')] },
		{ abbr: 'DEN', games: [game(16, 'KC', THURSDAY, 'final')] },
		{ abbr: 'LAR', games: [game(16, 'SEA', SATURDAY, 'final')] },
		{ abbr: 'SEA', games: [game(16, 'LAR', SATURDAY, 'final')] }
	];
	const reach = reachOf([], late, 15);
	assert.equal(reachWords(reach), "through week 15 and week 16's Thursday and Saturday games");
	const first = reachOf(
		[],
		slates('final', 'upcoming').map((s) => ({
			...s,
			games: s.games.map((g) => ({ ...g, week: 1 }))
		})),
		0
	);
	assert.equal(reachWords(first), "through week 1's Thursday game");
	assert.equal(playedThroughWords(first), "week 1's Thursday game is played");
});

void test('a run from before the states: a player past the complete week says part of the next', () => {
	const old = slates('final', 'kicked_off').map((s) => ({
		...s,
		games: s.games.map(({ week, opponent, kickoff }) => ({ week, opponent, kickoff }))
	}));
	const reach = reachOf([sundayPlayer, thursdayPlayer], old, 5);
	assert.deepEqual(reach, { complete: 5, partial: { week: 6, days: [], games: 0 } });
	assert.equal(reachWords(reach), 'through week 5 and part of week 6');
	assert.equal(reachWords(reachOf([sundayPlayer], old, 5)), 'through week 5');
	assert.equal(reachWords({ complete: 0, partial: null }), '');
});
