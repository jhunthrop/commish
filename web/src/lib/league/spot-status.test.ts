// Only what the host labels IR puts the IR mark on a face: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LeaguePlayer, RosterSpot } from './api.ts';
import { spotStatus } from './model.ts';

function spot(
	slot: RosterSpot['slot'],
	injuredReserve: boolean
): Pick<RosterSpot, 'slot' | 'player'> {
	const player: LeaguePlayer = {
		host_id: '26916',
		board_id: null,
		name: 'James Conner',
		position: 'RB',
		team: 'ARI',
		injured_reserve: injuredReserve
	};
	return { slot, player };
}

void test('the IR slot marks IR', () => {
	assert.equal(spotStatus(spot('reserve', false)), 'ir');
});

void test("the host's IR beside his name marks IR on any slot", () => {
	assert.equal(spotStatus(spot('bench', true)), 'ir');
});

void test('a bench or taxi player with no IR word carries no mark', () => {
	assert.equal(spotStatus(spot('bench', false)), null);
	assert.equal(spotStatus(spot('taxi', false)), null);
});
