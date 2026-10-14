// A followed league's line names the drafter's standing, so two alike names part: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AttachedLeague } from './api.ts';
import { followedLine } from './model.ts';

const league: AttachedLeague = {
	id: '4f93ee59-b4ec-470a-a73a-0e33c7319ac9',
	host: 'ffpc',
	host_league_id: '104870',
	season: 2026,
	name: 'Big Gorilla Tourney (Aug 21 9:00 PM) #104870',
	roster_id: 11,
	team_name: 'My Ball Zach Ertz',
	standing: { wins: 2, losses: 3, ties: 0, place: 11, teams: 12 },
	attached_at: '2026-10-13T12:00:00Z'
};

void test('a read league says the team, its record and place, and the host', () => {
	assert.equal(followedLine(league), 'My Ball Zach Ertz, 2-3, 11 of 12, on FFPC');
});

void test('an unread league says only what it has', () => {
	assert.equal(followedLine({ ...league, team_name: '', standing: null }), 'on FFPC');
});
