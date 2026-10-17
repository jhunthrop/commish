// Kickers and defenses on the run's boards (Lane 66m): the schema reads their rows and entries, the
// reader keeps them apart from the ranked rows, and the basis names their order once. Run with
// `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withStatuses } from './board-status.ts';
import { BUILT_ZONE, boardStatusWords } from './status-view.ts';
import { marketBasis, marketFace } from '#lib/site/market.ts';
import { marketAt, splitBoard, splitIndex, unindexedMarketRow } from './market.ts';
import { boardSchema, indexSchema, type MarketRow } from './schema.ts';

const ranked = {
	id: '4429795',
	slug: 'jahmyr-gibbs',
	name: 'Jahmyr Gibbs',
	position: 'RB',
	positionRank: 1,
	team: 'DET',
	headshot: 'https://a.espncdn.com/i/headshots/nfl/players/full/4429795.png',
	ourRank: 1,
	vorRound: 1,
	adp: 2.1,
	projected: 262.1,
	vor: 113.9,
	expectedGames: 16.2,
	floor: 177.6,
	median: 262.1,
	ceiling: 346.6,
	tier: 1
};

const NULLS = {
	vorRound: null,
	projected: null,
	vor: null,
	expectedGames: null,
	floor: null,
	median: null,
	ceiling: null,
	tier: null
};

const kicker = (id: string, positionRank: number, ourRank: number, adp: number | null) => ({
	id,
	slug: `kicker-${id}`,
	name: `Kicker ${id}`,
	position: 'K',
	positionRank,
	team: 'DAL',
	headshot: `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`,
	orderBasis: 'market',
	ourRank,
	adp,
	...NULLS
});

const defense = {
	id: 'DST-BUF',
	slug: 'buffalo-bills',
	name: 'Buffalo Bills',
	position: 'DST',
	positionRank: 1,
	team: 'BUF',
	headshot: null,
	orderBasis: 'market',
	ourRank: 2,
	adp: 140.2,
	...NULLS
};

const FILE = {
	format: 'ppr-12',
	rows: [
		{ ...ranked, orderBasis: 'projection' },
		defense,
		kicker('3', 2, 4, null),
		kicker('2', 1, 3, 150.5)
	]
};

void test('the schema reads a board with kickers and defenses after its ranked rows', () => {
	const board = splitBoard(boardSchema.parse(FILE));
	assert.deepEqual(
		board.rows.map((row) => row.id),
		['4429795']
	);
	assert.deepEqual(
		board.market.map((row) => [row.id, row.position, row.projected, row.tier]),
		[
			['DST-BUF', 'DST', null, null],
			['3', 'K', null, null],
			['2', 'K', null, null]
		]
	);
});

void test('a run older than the market rows still reads, every row ranked', () => {
	const board = splitBoard(boardSchema.parse({ format: 'ppr-12', rows: [ranked] }));
	assert.equal(board.rows.length, 1);
	assert.deepEqual(board.market, []);
});

void test('a market row with a projection is refused', () => {
	const bad = { ...FILE, rows: [ranked, { ...defense, projected: 120 }] };
	assert.equal(boardSchema.safeParse(bad).success, false);
	const noTier = { ...FILE, rows: [ranked, { ...defense, position: 'WR' }] };
	assert.equal(boardSchema.safeParse(noTier).success, false);
});

void test('the index keeps the pages apart from the kickers and defenses, and names every market row', () => {
	const entries = indexSchema.parse([
		{
			id: ranked.id,
			slug: ranked.slug,
			name: ranked.name,
			team: ranked.team,
			position: ranked.position,
			headshot: ranked.headshot,
			orderBasis: 'projection',
			season: { games: 5, pointsPerGame: 21.3 }
		},
		{
			id: 'DST-BUF',
			slug: 'buffalo-bills',
			name: 'Buffalo Bills',
			team: 'BUF',
			position: 'DST',
			headshot: null,
			orderBasis: 'market'
		}
	]);
	const index = splitIndex(entries);
	assert.deepEqual(
		index.pages.map((entry) => entry.id),
		['4429795']
	);
	assert.deepEqual(
		index.market.map((entry) => entry.id),
		['DST-BUF']
	);
	const board = splitBoard(boardSchema.parse(FILE));
	assert.equal(unindexedMarketRow(board, index.market)?.id, '3');
});

void test('a position lists its players in draft order, a defense with its club mark', () => {
	const board = splitBoard(boardSchema.parse(FILE));
	assert.deepEqual(
		marketAt(board.market, 'K').map((row) => row.id),
		['2', '3']
	);
	const [buffalo] = marketAt(board.market, 'DST');
	assert.ok(buffalo);
	assert.equal(marketFace(buffalo), 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png');
	const [first] = marketAt(board.market, 'K');
	assert.ok(first);
	assert.equal(marketFace(first), first.headshot);
});

void test('a kicker on a season-long list sits below the available kickers', () => {
	const board = splitBoard(boardSchema.parse(FILE));
	const capture = {
		readAt: '2026-10-16T12:00:00.000Z',
		checkedAt: null,
		source: 'tank01_injuries_by_date',
		players: { '2': { status: 'injured_reserve' as const, seasonLong: true, since: null } }
	};
	const rows: MarketRow[] = withStatuses(marketAt(board.market, 'K'), capture);
	assert.deepEqual(
		rows.map((row) => row.id),
		['3', '2']
	);
});

void test('the basis names the order and its drafts once', () => {
	const sources = [
		{
			id: 'ffc_adp_ppr_12',
			drafts: 'PPR drafts',
			formats: ['ppr-12'],
			window: { from: '2026-09-09T07:00:00.000Z', to: '2026-09-09T07:00:00.000Z' }
		}
	];
	assert.equal(
		marketBasis({ marketOrder: 'ffc_adp_ppr_12' }, sources),
		'Kickers and defenses rank in draft order from PPR drafts, Sep 9, with no projected points and no tiers.'
	);
	assert.equal(
		marketBasis({}, sources),
		'Kickers and defenses rank in draft order, with no projected points and no tiers.'
	);
});

void test("a kicker's season-long line names no figure of ours", () => {
	const status = {
		status: 'injured_reserve' as const,
		seasonLong: true,
		since: '2026-10-02T15:00:00.000Z'
	};
	const saying = {
		capture: { readAt: '2026-10-16T12:00:00.000Z', checkedAt: null },
		restOfSeason: false,
		zone: BUILT_ZONE,
		now: Date.parse('2026-10-16T13:00:00.000Z')
	};
	const words = boardStatusWords(
		[
			{ id: '2', status, orderBasis: 'market' },
			{ id: '4429795', status }
		],
		saying
	);
	assert.equal(
		words.rows['2']?.line,
		'On injured reserve since October 2, so he sits below the available players.'
	);
	assert.match(String(words.rows['4429795']?.line), /Our projection assumes he plays/);
	assert.equal(words.rows['2'].rank, 'IR');
});
