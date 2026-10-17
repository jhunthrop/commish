// The player card as the build words it (Lane 66h): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Format, PlayerFormat } from '#lib/run/schema.ts';
import type { GameLogRow, PlayerSeason, StatLine } from '#lib/run/season.ts';
import { STAT_FIELDS } from '#lib/run/season.ts';
import { cardBuild, gamesFrom, readStamp, restTile } from './player-card.ts';

const EMPTY = Object.fromEntries(STAT_FIELDS.map((field) => [field, null])) as Omit<
	StatLine,
	'snapShare' | 'points'
>;

function row(
	week: number,
	opponent: string | null,
	status: GameLogRow['status'],
	points: number | null = null
): GameLogRow {
	return {
		...EMPTY,
		snapShare: null,
		points,
		week,
		opponent,
		home: opponent === null ? null : week % 2 === 1,
		status
	};
}

/** Weeks 1 to 5 (2 and 3 missed), week 6 ahead, a bye in week 11, through week 18. */
function season(): PlayerSeason {
	const log = Array.from({ length: 18 }, (_, i) => {
		const week = i + 1;
		if (week === 11) return row(week, null, 'bye');
		if (week === 2 || week === 3) return row(week, 'NYG', 'inactive');
		if (week <= 5) return row(week, 'BUF', 'played', week * 10 + 0.4);
		return row(week, 'ARI', 'upcoming');
	});
	return {
		season: 2026,
		format: 'ppr-12',
		weeks: 18,
		through: 5,
		games: 3,
		pointsPerGame: 33.7,
		totals: { ...EMPTY, snapShare: null, points: 101.2 },
		log
	};
}

const NUMBERS = { positionRank: 1, projected: 254.1 } as PlayerFormat;
const PRESEASON = { id: 'ppr-12', label: 'PPR' } as Format;
const IN_SEASON = { ...PRESEASON, rosFromWeek: 6 } as Format;

void test('rest of season is his points from the first week, his points a game over his games left, and his rank in our order', () => {
	assert.equal(gamesFrom(season(), 6), 11);
	assert.deepEqual(restTile(IN_SEASON, NUMBERS, season(), 'WR', 2026), {
		key: 'rest',
		label: 'Rest of season',
		value: '254.1',
		caption: 'from week 6, 23.1 a game, WR1 in our order',
		tone: null
	});
	const preseason = restTile(PRESEASON, NUMBERS, season(), 'WR', 2026);
	assert.equal(preseason.label, 'Projected');
	assert.equal(preseason.caption, 'PPR points for 2026, WR1 in our order');
});

void test('the build holds Avg and Last from his season, the week tiles "--", and the week ahead', () => {
	const built = cardBuild(season(), null);
	assert.deepEqual(
		built.tiles.map((t) => [t.key, t.value, t.caption]),
		[
			['proj', '--', 'Week 6'],
			['opp', '--', 'at ARI'],
			['avg', '33.7', 'a game in 3 games'],
			['last', '50.4', 'week 5 vs BUF'],
			['delta', '--', '']
		]
	);
	assert.deepEqual(built.next, { week: 6, opponent: 'at ARI' });
	assert.deepEqual(built.opponents, { 1: 'vs BUF', 4: 'at BUF', 5: 'vs BUF' });
	assert.equal(built.games, 3);
	assert.equal(built.readStamp, null);
});

void test("the read's stamp is its day and what it was written from", () => {
	assert.equal(
		readStamp({ body: 'A read.', pulls: [], writtenAt: '2026-10-13T21:57:34.834Z' }),
		'Written Oct 13, from his facts through last season'
	);
	assert.equal(readStamp({ body: 'A read.', pulls: [] }), null);
});
