// The order's figures over the run's rows (Lane 220, live-order.ts): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BasisPart } from './board-basis.ts';
import { liveBasis, livePlaces, placedAt } from './live-order.ts';

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
