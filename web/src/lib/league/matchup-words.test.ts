// The matchup head never claims a game state it did not read: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LeagueMatchup, MatchupSide } from './api.ts';
import { matchupAside } from './model.ts';

function side(points: number, pointsRead: boolean): MatchupSide {
	return { roster_id: 11, points, points_read: pointsRead, starters: [] };
}

function matchup(mine: MatchupSide): LeagueMatchup {
	return { week: 6, mine, opponent: null };
}

void test('an all-play week with an unread score says nothing about games played', () => {
	assert.equal(matchupAside(matchup(side(0, false)), true, false), undefined);
});

void test('an all-play week with a read score of 0 shows it as points so far', () => {
	assert.equal(matchupAside(matchup(side(0, true)), true, false), 'Points so far');
});

void test('a head-to-head week says no games played only when the read shows every side at 0', () => {
	assert.equal(matchupAside(matchup(side(0, true)), false, false), 'No games played yet');
	assert.equal(matchupAside(matchup(side(12.5, true)), false, true), 'Points so far');
});
