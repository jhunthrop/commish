// A free agent in the draft room's pool (Lane 123, B101): the API names him "FA" with no bye, and the
// room's player carries that as his club cell, no club mark, no bye. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FREE_AGENT_CLUB, isFreeAgent } from '#lib/format/clubs.ts';
import type { RoomBoard } from './api.ts';
import { boardOf } from './model.ts';

const player = (
	id: string,
	over: Partial<RoomBoard['players'][number]>
): RoomBoard['players'][number] => ({
	id,
	name: id,
	position: 'WR',
	team: 'DAL',
	headshot: '',
	adp: 120.4,
	points: 60,
	vor: 2,
	position_rank: 80,
	bye: 10,
	...over
});

void test("the room's pool reads a free agent's club cell FA, with no bye", () => {
	const read = boardOf(
		{
			format: 'ppr',
			season: 2026,
			as_of: '2026-10-20T10:00:00.000Z',
			basis: '',
			players: [player('sharpe', { team: 'FA', bye: null }), player('lamb', {})]
		},
		12
	);
	const sharpe = read.byId.get('sharpe');
	const lamb = read.byId.get('lamb');
	assert.ok(sharpe !== undefined && lamb !== undefined);
	assert.equal(FREE_AGENT_CLUB, 'FA');
	assert.equal(sharpe.team, 'FA');
	assert.equal(sharpe.bye, null);
	assert.equal(sharpe.headshot, '');
	assert.ok(isFreeAgent(sharpe.team));
	assert.equal(lamb.team, 'DAL');
	assert.equal(lamb.bye, 10);
	assert.ok(!isFreeAgent(lamb.team));
});
