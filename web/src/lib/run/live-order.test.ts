// The order's figures over the run's rows (Lane 220, live-order.ts): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BasisPart } from './board-basis.ts';
import { inSeasonStamp } from '#lib/front/live-board.ts';
import {
	LIVE_ORDER_WORDS,
	basisAtClock,
	inScoring,
	liveBasis,
	liveCapture,
	livePlaces,
	omittedFromRun,
	placedAt,
	placedPair
} from './live-order.ts';

const lead: BasisPart = {
	text: 'Our rest-of-season order from week 7, read 1:41 pm Central.',
	phone: true
};

void test("the order's lead takes the run's board sentence, or leads a basis that names no board", () => {
	const board: BasisPart = {
		text: 'Our PPR board, refreshed October 25.',
		phone: true,
		topic: 'board'
	};
	const season: BasisPart = { text: "GP and Avg are this season's.", phone: false };
	const wins: BasisPart = { text: 'Opponents show expected wins.', phone: true };
	assert.deepEqual(liveBasis([wins, board, season], lead), [wins, lead, season]);
	assert.deepEqual(liveBasis([season], lead), [lead, season]);
});

void test('a place takes the order rank, place, figures and round, and leaves the run Gap unsaid', () => {
	const run = { ourRank: 5, positionRank: 3, projected: 183.2, vor: 95.3, vorRound: 1, gap: -2.7 };
	assert.deepEqual(placedAt(run, { rank: 13, positionRank: 4, projected: 164.9, vor: 80.1 }, 12), {
		ourRank: 13,
		positionRank: 4,
		projected: 164.9,
		vor: 80.1,
		vorRound: 2,
		gap: null
	});
	// A player on a season-long list has no place at his position in the order: the run's word stands.
	assert.equal(
		placedAt(run, { rank: 300, positionRank: null, projected: 1, vor: -90 }, 12).positionRank,
		3
	);
});

void test('the places skip a row with no board id or no figure', () => {
	const row = (id: string | null, points: number | null) => ({
		rank: 1,
		rest_of_season_points: points,
		points_over_replacement: 10,
		line: { player: { board_id: id }, position_rank: 1 }
	});
	const places = livePlaces({
		rows: [row('a', 100), row(null, 90), row('c', null)] as unknown as Parameters<
			typeof livePlaces
		>[0]['rows']
	});
	assert.deepEqual([...places.keys()], ['a']);
});

void test("a place's rank is his full-order number, his rank on an answer from before it (Lane 234)", () => {
	const row = (rank: number, overall?: number) =>
		({
			rank,
			...(overall === undefined ? {} : { overall_rank: overall }),
			rest_of_season_points: 100,
			points_over_replacement: 10,
			line: { player: { board_id: 'a' }, position_rank: 4 }
		}) as unknown as Parameters<typeof livePlaces>[0]['rows'][number];
	assert.equal(livePlaces({ rows: [row(3, 7)] }).get('a')?.rank, 7);
	assert.equal(livePlaces({ rows: [row(3)] }).get('a')?.rank, 3);
});

void test("compare draws the order's pair only in the board's format and only with both placed", () => {
	const place = { rank: 2, positionRank: 15, projected: 103, vor: 52.8 };
	const places = new Map([
		['swift', place],
		['burrow', { ...place, rank: 13, positionRank: 4 }]
	]);
	// Both placed, in the board's own format: the order's.
	assert.equal(placedPair(['swift', 'burrow'], places, 'ppr-12', 'ppr-12'), places);
	// One missing: neither side takes the order's.
	assert.equal(placedPair(['swift', 'nacua'], places, 'ppr-12', 'ppr-12'), null);
	// Another format compared: the run's, as the order is read in the board's scoring alone.
	assert.equal(placedPair(['swift', 'burrow'], places, 'half-ppr-12', 'ppr-12'), null);
	// Not read yet.
	assert.equal(placedPair(['swift', 'burrow'], null, 'ppr-12', 'ppr-12'), null);
});

void test("an order answered in another scoring than the board's is refused", () => {
	const scoring = (format: 'ppr' | 'half_ppr' | 'standard') => ({
		projection_scoring: { format, league_own: false }
	});
	assert.equal(inScoring(scoring('ppr'), 'ppr'), true);
	assert.equal(inScoring(scoring('half_ppr'), 'ppr'), false);
	assert.equal(inScoring(scoring('ppr'), null), false);
});

void test("a page says the run's time on the run's rows and the order's lead on the order's", () => {
	const board: BasisPart = {
		text: 'Our PPR board, refreshed October 25.',
		phone: true,
		topic: 'board'
	};
	const stamp = inSeasonStamp(
		{ rosFromWeek: 7, refreshedAt: '2026-10-25T05:51:19.530Z' },
		'America/Chicago'
	);
	assert.deepEqual(stamp, { text: 'Projected updated Sun Oct 25, 12:51 am Central.', phone: true });
	// Unread or failed: the run's basis and its stamp.
	assert.deepEqual(basisAtClock([board], null, stamp), [board, stamp]);
	// Read: the order's lead in the board sentence's place, no run stamp.
	assert.deepEqual(basisAtClock([board], lead, stamp), [lead]);
	// The clubs index has no basis of its own: its one part is the lead or the stamp.
	assert.deepEqual(basisAtClock([], null, stamp), [stamp]);
	assert.deepEqual(basisAtClock([], lead, stamp), [lead]);
	// Before the season no stamp is said.
	assert.equal(inSeasonStamp({ refreshedAt: '2026-09-01T05:00:00.000Z' }, 'America/Chicago'), null);
});

void test('the run’s players an uncut order omits are counted once, only when there are any (Lane 280)', () => {
	assert.equal(LIVE_ORDER_WORDS.fromRunLine(0), null);
	assert.equal(
		LIVE_ORDER_WORDS.fromRunLine(1),
		'1 player from our board, not in our order right now.'
	);
	assert.equal(
		LIVE_ORDER_WORDS.fromRunLine(3),
		'3 players from our board, not in our order right now.'
	);
});

void test('the answer’s status read is its capture, none from an older answer (Lane 280)', () => {
	const at = '2026-10-22T14:05:00.000Z';
	const read = { as_of: '2026-10-22T13:00:00.000Z', checked_at: at, source: 'feed' };
	const answer = { status_read: read } as unknown as Parameters<typeof liveCapture>[0];
	assert.deepEqual(liveCapture(answer), { readAt: read.as_of, checkedAt: at });
	assert.equal(liveCapture({} as unknown as Parameters<typeof liveCapture>[0]), null);
});

void test('an uncut answer’s omissions are the run’s to draw, a cut answer’s are its limit’s (Lane 280)', () => {
	type Answer = Parameters<typeof omittedFromRun>[1];
	const answer = (ids: string[], total: number): Answer =>
		({
			rows: ids.map((id) => ({ line: { player: { board_id: id } } })),
			total
		}) as unknown as Answer;
	assert.deepEqual(omittedFromRun(['a', 'b', 'c', 'd'], answer(['c', 'a', 'x'], 3)), ['b', 'd']);
	assert.deepEqual(omittedFromRun(['a', 'b'], answer(['b', 'a'], 2)), []);
	assert.deepEqual(omittedFromRun(['a', 'b', 'c'], answer(['a'], 40)), [], 'cut');
});
