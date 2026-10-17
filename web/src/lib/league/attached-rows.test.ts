// The Account room's Leagues attached table (Lane 66k). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AttachedLeague } from './api.ts';
import { ATTACHED_WORDS, attachedRow } from './attached-rows.ts';

const NOW = new Date('2026-10-17T15:12:00.000Z');

const league: AttachedLeague = {
	id: 'suck',
	host: 'sleeper',
	host_league_id: '1',
	season: 2026,
	name: 'S.U.C.K.',
	roster_id: 1,
	team_name: 'McConkey Kong Country',
	standing: { wins: 1, losses: 4, ties: 0, place: 12, teams: 12 },
	attached_at: '2026-09-01T12:00:00.000Z',
	last_read_at: '2026-10-17T15:08:00.000Z',
	phase: 'in_season',
	phase_basis: '',
	draft_at: null,
	playoff_start_week: 15,
	waivers_open: true
};

void test('a league reads its team, record, place, season and last read from the API', () => {
	assert.deepEqual(attachedRow(league, NOW, 'America/Chicago'), {
		id: 'suck',
		name: 'S.U.C.K.',
		team: 'McConkey Kong Country, on Sleeper',
		record: '1-4',
		place: '12th of 12',
		season: 'In season, playoffs from week 15',
		read: '4 minutes ago'
	});
});

void test('before a read, out of season and with no playoff week, each says so', () => {
	const row = attachedRow(
		{ ...league, standing: null, team_name: '', last_read_at: null, phase: 'offseason' },
		NOW
	);
	assert.deepEqual(
		[row.team, row.record, row.place, row.season, row.read],
		['on Sleeper', '--', '', 'Season over', '--']
	);
	assert.equal(
		attachedRow({ ...league, playoff_start_week: null }, NOW).season,
		ATTACHED_WORDS.inSeason
	);
	assert.equal(
		attachedRow({ ...league, last_read_at: '2026-10-12T12:00:00.000Z' }, NOW).read,
		'Oct 12'
	);
});
