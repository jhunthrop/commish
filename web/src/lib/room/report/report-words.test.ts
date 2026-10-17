// The report's words for a kicker or a defense (Lane 66m): his pick reads his place in draft order,
// and the team total says it counts the projected positions. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RoomPlayer } from '../model.ts';
import { pickFigure, totalCaption } from './headline.ts';

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

void test('the team total names the positions it counts', () => {
	assert.equal(
		totalCaption('your', '5th of 12, the leader at 1,593'),
		'projected points from your QB, RB, WR and TE starters, 5th of 12, the leader at 1,593'
	);
});
