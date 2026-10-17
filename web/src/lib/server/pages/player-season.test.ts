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
