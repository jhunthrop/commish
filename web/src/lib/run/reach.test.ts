// How far a screen's "through week" reaches (Lane 80, the sweep's M2 and Y2, the review's finding 1):
// the last complete week, then the next week's games some player's counts already hold, named by
// their day ("week 6's Thursday game"), so the basis never claims a week a Sunday player's GP does not
// reach. A final by status with no line behind it reaches nothing; finals only fade the schedule.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countedReach, finalsReach, playedThroughWords, reachWords, type Reach } from './reach.ts';
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
const thursdayPlayer = { team: 'SEA', through: 5, log: [row(5, 'played'), row(6, 'played')] };
const sundayPlayer = { team: 'BUF', through: 5, log: [row(5, 'played'), row(6, 'upcoming')] };

void test("the Monday after: week 5, and week 6 by the day of the one game a player's counts hold", () => {
	// Sunday's game is final by the hourly status, its lines not in: it reaches nothing.
	const reach = countedReach([sundayPlayer, thursdayPlayer], slates('final', 'final'), 5);
	assert.deepEqual(reach, { complete: 5, partial: { week: 6, days: ['Thursday'], games: 1 } });
	assert.equal(reachWords(reach), "through week 5 and week 6's Thursday game");
});

void test('a Sunday final by status with no week 6 line is still through week 5 (review finding 1)', () => {
	const reach = countedReach([sundayPlayer], slates('final', 'final'), 5);
	assert.deepEqual(reach, { complete: 5, partial: null });
	assert.equal(reachWords(reach), 'through week 5');
});

void test("the schedule fades the run's finals: weeks 1 to 5 and every week 6 game final by its state", () => {
	const reach = finalsReach(slates('final', 'final'), 5);
	assert.equal(
		playedThroughWords(reach),
		"weeks 1 to 5 and week 6's Thursday and Sunday games are played"
	);
	assert.equal(
		playedThroughWords(finalsReach(slates('final', 'kicked_off'), 5)),
		"weeks 1 to 5 and week 6's Thursday game are played"
	);
});

void test('the Tuesday after, every game in: the week is complete and named alone', () => {
	const reach: Reach = { complete: 6, partial: null };
	assert.equal(reachWords(reach), 'through week 6');
	assert.equal(playedThroughWords(reach), 'weeks 1 to 6 are played');
	assert.equal(playedThroughWords({ complete: 1, partial: null }), 'week 1 is played');
});

void test('two days of a late week, and a first week with only its Thursday in', () => {
	const late = [
		{ abbr: 'KC', games: [game(16, 'DEN', THURSDAY)] },
		{ abbr: 'DEN', games: [game(16, 'KC', THURSDAY)] },
		{ abbr: 'LAR', games: [game(16, 'SEA', SATURDAY)] },
		{ abbr: 'SEA', games: [game(16, 'LAR', SATURDAY)] }
	];
	const counted = (team: string) => ({ team, through: 15, log: [row(16, 'played')] });
	const reach = countedReach([counted('KC'), counted('DEN'), counted('LAR')], late, 15);
	assert.equal(reachWords(reach), "through week 15 and week 16's Thursday and Saturday games");
	const first = countedReach(
		[{ team: 'SEA', through: 0, log: [row(1, 'played')] }],
		slates('final', 'upcoming').map((s) => ({
			...s,
			games: s.games.map((g) => ({ ...g, week: 1 }))
		})),
		0
	);
	assert.equal(reachWords(first), "through week 1's Thursday game");
	assert.equal(playedThroughWords(first), "week 1's Thursday game is played");
});

void test('a counted player whose club the schedule does not place says part of the week', () => {
	const lost = { team: 'XXX', through: 5, log: [row(6, 'played')] };
	assert.equal(
		reachWords(countedReach([lost], slates('final', 'final'), 5)),
		'through week 5 and part of week 6'
	);
	assert.equal(reachWords({ complete: 0, partial: null }), '');
});
