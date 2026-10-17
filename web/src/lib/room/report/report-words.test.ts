// The report's words for a kicker or a defense (Lane 66m): his pick reads his place in draft order,
// and the team total says it counts the projected positions. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MockReport } from '../api.ts';
import type { RoomPlayer } from '../model.ts';
import {
	adpLater,
	boardLater,
	byWords,
	pickFigure,
	reportBasis,
	standingCells,
	stillThereCell,
	totalCaption
} from './headline.ts';

const player = (position: RoomPlayer['position'], positionRank: number): RoomPlayer => ({
	id: 'p',
	name: 'Brandon Aubrey',
	position,
	positionRank,
	team: 'DAL',
	headshot: '',
	adp: 120,
	points: null,
	vor: null,
	vorRound: null,
	bye: 10
});

void test('a kicker or a defense pick reads its place in draft order', () => {
	assert.deepEqual(pickFigure(null, player('K', 3)), { text: 'Draft order 3', muted: true });
	assert.deepEqual(pickFigure(null, player('DST', 1)), { text: 'Draft order 1', muted: true });
});

void test('a projected pick reads its points over replacement, signed', () => {
	assert.deepEqual(pickFigure(12.34, player('RB', 4)), { text: '+12.3', muted: false });
	assert.deepEqual(pickFigure(null, player('RB', 4)), { text: 'no projection', muted: true });
	assert.deepEqual(pickFigure(null, undefined), { text: 'no projection', muted: true });
});

void test('the team total names the positions it counts, in one line', () => {
	assert.equal(totalCaption('your'), 'points from your QB, RB, WR and TE starters');
});

type Team = MockReport['standings'][number];
type Pick = MockReport['picks'][number];

const team = (seat: number, rank: number, points: number): Team => ({
	seat,
	rank,
	points,
	starters_filled: 9,
	starters_total: 9,
	bye_collisions: 0,
	value_captured: 0
});

void test('the finish is cells: your place, the team just ahead and the leader', () => {
	const field = [team(1, 12, 1246.4), team(2, 11, 1467.2), team(3, 1, 1592.5), team(4, 2, 1557)];
	const last = standingCells(field, 1, 12);
	assert.deepEqual(
		last?.cells.map((c) => [c.label, c.value]),
		[
			['of 12', '12th'],
			['11th', '1,467'],
			['Leader', '1,593']
		]
	);
	const second = standingCells(field, 4, 12);
	assert.deepEqual(
		second?.cells.map((c) => [c.label, c.value]),
		[
			['of 12', '2nd'],
			['Leader', '1,593']
		]
	);
	const first = standingCells(field, 3, 12);
	assert.deepEqual(
		first?.cells.map((c) => [c.label, c.value]),
		[
			['of 12', '1st'],
			['2nd', '1,557']
		]
	);
});

const pick = (over: Partial<Pick>): Pick => ({
	pick: 25,
	round: 3,
	player_id: 'p',
	over_replacement: 25.6,
	board_rank: 44,
	board_gap: -19,
	adp_gap: -1.8,
	chip: 'at_adp',
	still_there: null,
	could_wait: false,
	odds_source: 'sim',
	made_by: 'for_you',
	...over
});

void test('Picks later prints the API figures as given, green when he came later than his place', () => {
	assert.deepEqual(adpLater(pick({ adp_gap: -125.4 })), { text: '−125.4', tone: 'loss' });
	assert.deepEqual(adpLater(pick({ adp_gap: 9 })), { text: '+9.0', tone: 'gain' });
	assert.deepEqual(adpLater(pick({ adp_gap: 0 })), { text: '0', tone: 'even' });
	assert.equal(adpLater(pick({ adp_gap: null })), null);
	assert.deepEqual(boardLater(pick({})), { text: '−19', tone: 'loss' });
	assert.deepEqual(boardLater(pick({ board_gap: 31 })), { text: '+31', tone: 'gain' });
	assert.equal(boardLater(pick({ board_gap: null })), null);
	assert.equal(boardLater(pick({ chip: 'kept' })), null);
});

void test('Still there is tinted when he could have waited, and empty for a pick nobody chose', () => {
	assert.deepEqual(stillThereCell(pick({ made_by: 'you', still_there: 0.999 }), 169, 0.6), {
		text: '>99%',
		wait: true,
		muted: false
	});
	assert.deepEqual(stillThereCell(pick({ made_by: 'you', still_there: 0.3 }), 169, 0.6), {
		text: '30%',
		wait: false,
		muted: false
	});
	assert.equal(stillThereCell(pick({}), 169, 0.6).text, '');
	assert.equal(stillThereCell(pick({ made_by: 'you', pick: 169 }), 169, 0.6).text, 'last pick');
	assert.equal(byWords(pick({}), 'your'), 'Pick for me');
	assert.equal(byWords(pick({ made_by: 'you' }), 'their'), 'Them');
});

void test('the basis says Picks later and Still there once, after the board', () => {
	const said = reportBasis('Points are our 2026 PPR projections.', 0.6);
	assert.equal(
		said,
		"Points are our 2026 PPR projections. Picks later: the pick less his ADP or our board's place (no kickers or defenses), plus is later. Still there: the room's read at that pick, tinted from 60%."
	);
	assert.doesNotMatch(said, /[;—]|\bodds\b/);
});
