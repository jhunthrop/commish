// A player's season block as the build words it: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Format } from '#lib/run/schema.ts';
import { STAT_FIELDS, type GameLogRow, type PlayerSeason, type StatLine } from '#lib/run/season.ts';
import { seasonView } from './player-season.ts';

const EMPTY = Object.fromEntries(STAT_FIELDS.map((field) => [field, null])) as Omit<
	StatLine,
	'snapShare' | 'points'
>;

function played(week: number, points: number): GameLogRow {
	return { ...EMPTY, snapShare: null, points, week, opponent: 'BUF', home: true, status: 'played' };
}

const FORMAT = { id: 'ppr-12', label: 'PPR' } as Format;
const KICKOFF = '2026-10-25T17:00:00.000Z';

void test("the season's total is the sum of the points the rows print, so the box adds up", () => {
	// Three weeks of 10.04: each row prints 10.0, the raw total 30.12 would print 30.1.
	const log = [played(1, 10.04), played(2, 10.04), played(3, 10.04)];
	const season: PlayerSeason = {
		season: 2026,
		format: 'ppr-12',
		weeks: 3,
		through: 3,
		games: 3,
		pointsPerGame: 10,
		totals: { ...EMPTY, snapShare: null, points: 30.12 },
		log
	};
	const view = seasonView(season, 'WR', [FORMAT], () => null);
	assert.deepEqual(
		view.rows.map((r) => r.points),
		['10.0', '10.0', '10.0']
	);
	assert.equal(view.line?.total, '30.0');
});

void test('a season with no games played says he has no stats, never stat lines', () => {
	const season: PlayerSeason = {
		season: 2026,
		format: 'ppr-12',
		weeks: 18,
		through: 6,
		games: 0,
		pointsPerGame: null,
		totals: { ...EMPTY, snapShare: null, points: null },
		log: []
	};
	assert.equal(
		seasonView(season, 'WR', [FORMAT], () => null).none,
		'He has no 2026 stats through week 6.'
	);
});

void test('his earlier seasons are rows in the same columns, newest first, worded like the season line', () => {
	const season: PlayerSeason = {
		season: 2026,
		format: 'ppr-12',
		weeks: 1,
		through: 1,
		games: 1,
		pointsPerGame: 10,
		totals: { ...EMPTY, snapShare: null, points: 10 },
		log: [played(1, 10)]
	};
	const prior = {
		season: 2025,
		games: 16,
		pointsPerGame: 23.4,
		totals: { ...EMPTY, receptions: 129, targets: 166, snapShare: 0.68, points: 375 }
	};
	const [row] = seasonView(season, 'WR', [FORMAT], () => null, [prior]).prior;
	assert.ok(row);
	assert.equal(row.season, 2025);
	assert.equal(row.sub, '16 games, 23.4 a game');
	assert.equal(row.total, '375.0');
	assert.deepEqual(row.cells.slice(0, 2), ['166', '129']);
});

void test("the head reaches his newest game in the records, Thursday's before Sunday's are in (the sweep's X3)", () => {
	const upcoming: GameLogRow = { ...played(7, 0), points: null, status: 'upcoming' };
	const season: PlayerSeason = {
		season: 2026,
		format: 'ppr-12',
		weeks: 7,
		through: 5,
		games: 6,
		pointsPerGame: 27.5,
		totals: { ...EMPTY, snapShare: null, points: 165 },
		log: [...[1, 2, 3, 4, 5, 6].map((week) => played(week, 27.5)), upcoming]
	};
	assert.equal(
		seasonView(season, 'WR', [FORMAT], () => ({ kickoff: KICKOFF, state: null })).aside,
		'2026, PPR, through week 6'
	);
	const sunday: PlayerSeason = {
		...season,
		games: 5,
		log: [...season.log.slice(0, 5), { ...upcoming, week: 6 }, upcoming]
	};
	assert.equal(
		seasonView(sunday, 'WR', [FORMAT], () => ({ kickoff: KICKOFF, state: null })).aside,
		'2026, PPR, through week 5'
	);
});

void test("the weeks still to play name a game kicked off or final by the run's state, else its day (Lane 80)", () => {
	const upcoming = (week: number): GameLogRow => ({
		...played(week, 0),
		points: null,
		status: 'upcoming'
	});
	const season: PlayerSeason = {
		season: 2026,
		format: 'ppr-12',
		weeks: 8,
		through: 5,
		games: 5,
		pointsPerGame: 27.5,
		totals: { ...EMPTY, snapShare: null, points: 137.5 },
		log: [
			...[1, 2, 3, 4, 5].map((week) => played(week, 27.5)),
			upcoming(6),
			upcoming(7),
			upcoming(8)
		]
	};
	const states = { 6: 'kicked_off', 7: 'final', 8: 'upcoming' } as const;
	const view = seasonView(season, 'WR', [FORMAT], ({ week }) => ({
		kickoff: KICKOFF,
		state: states[week as keyof typeof states]
	}));
	assert.deepEqual(
		view.ahead.map((row) => row.day),
		['Kicked off', 'Final', 'Sun Oct 25']
	);
	// A run from before the field: the day, as before.
	const before = seasonView(season, 'WR', [FORMAT], () => ({ kickoff: KICKOFF, state: null }));
	assert.deepEqual(
		before.ahead.map((row) => row.day),
		['Sun Oct 25', 'Sun Oct 25', 'Sun Oct 25']
	);
});

void test('a week whose club the run cannot name says he did not play, never Bye (Lane 120)', () => {
	const quiet = (week: number, opponent: string | null): GameLogRow => ({
		...EMPTY,
		snapShare: null,
		points: null,
		week,
		opponent,
		home: opponent === null ? null : false,
		status: 'inactive'
	});
	const bye: GameLogRow = { ...quiet(3, null), status: 'bye' };
	const season: PlayerSeason = {
		season: 2026,
		format: 'ppr-12',
		weeks: 4,
		through: 4,
		games: 1,
		pointsPerGame: 27.5,
		totals: { ...EMPTY, snapShare: null, points: 27.5 },
		log: [quiet(1, null), quiet(2, 'KC'), bye, played(4, 27.5)]
	};
	const view = seasonView(season, 'WR', [FORMAT], () => null);
	assert.deepEqual(
		view.rows.map((row) => [row.opponent, row.note, row.tone]),
		[
			['Did not play', '', 'quiet'],
			['at KC', 'Did not play', 'quiet'],
			['Bye', '', 'bye'],
			['vs BUF', '', 'played']
		]
	);
});

void test("a free agent's weeks past the records list no row, and his played weeks stand (Lane 123)", () => {
	const quiet = (week: number): GameLogRow => ({
		...EMPTY,
		snapShare: null,
		points: null,
		week,
		opponent: null,
		home: null,
		status: 'inactive'
	});
	const season: PlayerSeason = {
		season: 2026,
		format: 'ppr-12',
		weeks: 6,
		through: 3,
		games: 1,
		pointsPerGame: 12.5,
		totals: { ...EMPTY, snapShare: null, points: 12.5 },
		log: [played(1, 12.5), quiet(2), quiet(3), quiet(4), quiet(5), quiet(6)]
	};
	const view = seasonView(season, 'WR', [FORMAT], () => null);
	assert.deepEqual(
		view.rows.map((row) => [row.week, row.opponent]),
		[
			[1, 'vs BUF'],
			[2, 'Did not play'],
			[3, 'Did not play']
		]
	);
	assert.deepEqual(view.ahead, []);
	// Lane 138: his week of offensive snaps with no club edge is a game he played, never "Did not play".
	const snapped = {
		...season,
		log: season.log.map((r) => (r.week === 2 ? { ...r, unnamedGame: true as const } : r))
	};
	assert.deepEqual(
		seasonView(snapped, 'WR', [FORMAT], () => null).rows.map((row) => [
			row.opponent,
			row.note,
			row.tone
		]),
		[
			['vs BUF', '', 'played'],
			['Played, no line', '', 'quiet'],
			['Did not play', '', 'quiet']
		]
	);
});
