// The player card as the build words it (Lane 66h): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Format, PlayerFormat, PlayerStatus } from '#lib/run/schema.ts';
import type { GameLogRow, PlayerSeason, StatLine } from '#lib/run/season.ts';
import { STAT_FIELDS } from '#lib/run/season.ts';
import { cardBuild, readStamp, restParts, restTile } from './player-card.ts';

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
const PRESEASON = { id: 'ppr-12', label: 'PPR', teams: 12 } as Format;
const IN_SEASON = { ...PRESEASON, rosFromWeek: 6 } as Format;

const HELD = {
	status: 'injured_reserve',
	seasonLong: true,
	asOf: '2026-09-28T12:00:00.000Z'
} as unknown as PlayerStatus;
const QUESTIONABLE = { ...HELD, status: 'questionable', seasonLong: false } as PlayerStatus;

void test('rest of season is his points from the first week and his rank in our order', () => {
	assert.deepEqual(restTile(IN_SEASON, NUMBERS, 'WR', 2026, undefined), {
		key: 'rest',
		label: 'Rest of season',
		value: '254.1',
		caption: 'from week 6, WR1 in our order',
		tone: null
	});
	const preseason = restTile(PRESEASON, NUMBERS, 'WR', 2026, undefined);
	assert.equal(preseason.label, 'Projected');
	assert.equal(preseason.caption, 'PPR points for 2026, WR1 in our order');
});

void test("a held player's tile gives the word, never the rank his figure would earn (Lane 63)", () => {
	assert.equal(
		restTile(IN_SEASON, NUMBERS, 'RB', 2026, HELD).caption,
		'from week 6, RB IR, unranked while on a season-long list'
	);
	assert.equal(
		restTile(PRESEASON, NUMBERS, 'RB', 2026, HELD).caption,
		'PPR points for 2026, RB IR, unranked while on a season-long list'
	);
	// A designation for the week is no season-long list: the rank stands.
	assert.equal(
		restTile(IN_SEASON, NUMBERS, 'RB', 2026, QUESTIONABLE).caption,
		'from week 6, RB1 in our order'
	);
});

void test("the rest tile's parts carry its first week, its rank words and its scoring", () => {
	assert.deepEqual(restParts(IN_SEASON, NUMBERS, 'WR', undefined), {
		from: 'from week 6',
		rank: 'WR1 in our order',
		scoring: 'ppr',
		label: 'PPR'
	});
	assert.equal(restParts(PRESEASON, NUMBERS, 'WR', undefined), null);
	// Lane 86: his club's game of the board's first week was played at the run, so his own week leads.
	const played = { ...NUMBERS, restFromWeek: 7 };
	assert.equal(restParts(IN_SEASON, played, 'WR', undefined)?.from, 'from week 7');
	assert.equal(
		restTile(IN_SEASON, played, 'WR', 2026, undefined).caption,
		'from week 7, WR1 in our order'
	);
	assert.equal(
		restParts(IN_SEASON, { ...NUMBERS, restFromWeek: null }, 'WR', undefined)?.from,
		'with no game left'
	);
	const half: Format = { ...IN_SEASON, id: 'half-ppr-12', label: 'Half PPR' };
	assert.equal(restParts(half, NUMBERS, 'WR', undefined)?.scoring, 'half_ppr');
	const superflex: Format = { ...IN_SEASON, id: 'superflex-12', label: 'Superflex' };
	assert.equal(restParts(superflex, NUMBERS, 'WR', undefined)?.scoring, 'ppr');
});

void test('the build holds Avg and Last from his season, the week tiles "--", and the week ahead', () => {
	const built = cardBuild(season(), null);
	assert.deepEqual(
		built.tiles.map((t) => [t.key, t.value, t.caption]),
		[
			['proj', '--', 'Read as the page opens'],
			['opp', '--', 'at ARI'],
			['avg', '33.7', 'a game in 3 games'],
			['last', '50.4', 'week 5 vs BUF'],
			['delta', '--', '']
		]
	);
	// Headed by the run's week ahead until the API's read arrives.
	assert.equal(built.tiles[0]?.label, 'Wk 6');
	assert.deepEqual(built.next, { week: 6, opponent: 'at ARI' });
	assert.deepEqual(built.opponents, { 1: 'vs BUF', 4: 'at BUF', 5: 'vs BUF' });
	assert.equal(built.games, 3);
	assert.equal(built.readStamp, null);
});

void test('a bye in the week ahead heads the card as the bye, never the week after it (the sweep M6)', () => {
	const off = season();
	const log = off.log.map((r) =>
		r.week === 6 ? row(6, null, 'bye') : r.week === 11 ? row(11, 'ARI', 'upcoming') : r
	);
	const built = cardBuild({ ...off, log }, null);
	assert.deepEqual(built.next, { week: 6, opponent: 'Bye' });
	assert.equal(built.tiles[0]?.label, 'Wk 6');
	assert.equal(built.tiles.find((t) => t.key === 'opp')?.caption, 'Bye');
	// A bye already behind the counted week is history: the next game heads.
	const past = cardBuild(
		{
			...off,
			through: 6,
			log: log.map((r) => (r.week === 6 ? r : r.week === 7 ? row(7, 'NYJ', 'upcoming') : r))
		},
		null
	);
	assert.deepEqual(past.next, { week: 7, opponent: 'vs NYJ' });
});

void test("the read's stamp is its day and what it was written from", () => {
	assert.equal(
		readStamp({ body: 'A read.', pulls: [], writtenAt: '2026-10-13T21:57:34.834Z' }),
		'Written Oct 13, from his facts through last season'
	);
	assert.equal(readStamp({ body: 'A read.', pulls: [] }), null);
});
