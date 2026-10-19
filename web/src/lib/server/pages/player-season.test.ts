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
		seasonView(season, 'WR', [FORMAT], () => KICKOFF).aside,
		'2026, PPR, through week 6'
	);
	const sunday: PlayerSeason = {
		...season,
		games: 5,
		log: [...season.log.slice(0, 5), { ...upcoming, week: 6 }, upcoming]
	};
	assert.equal(
		seasonView(sunday, 'WR', [FORMAT], () => KICKOFF).aside,
		'2026, PPR, through week 5'
	);
});
