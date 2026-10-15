// The lineup move made on the host from our screen: the move the screen sends, when the verb sets
// it, the panel's steps and its words. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HostMovePlan, HostMoveResult, LineupSlot } from './api.ts';
import {
	MOVE_LINES,
	hostSaid,
	lineupMove,
	openHostWords,
	planStep,
	readingWords,
	resultStep,
	setsOnHost,
	settingWords
} from './move.ts';

const player = (id: string, name: string): LineupSlot['ours'] => ({
	player: { host_id: id, board_id: null, name, position: 'RB', team: 'TB', injured_reserve: false },
	headshot: null,
	slug: null,
	position_rank: null,
	points_over_replacement: null,
	held: false,
	facts: {
		week: 7,
		opponent: 'BUF',
		home: false,
		kickoff: '2026-10-18T17:00:00.000Z',
		bye: false,
		designation: null,
		played: false,
		points_this_week: null,
		last_games: [],
		allowed_to_position: null
	}
});

const slots: LineupSlot[] = [
	{
		slot: 'QB',
		ours: player('1', 'Patrick Mahomes'),
		host: player('1', 'Patrick Mahomes'),
		changed: false,
		sentence: null
	},
	{
		slot: 'RB',
		ours: player('2', 'Rachaad White'),
		host: player('3', 'Tank Bigsby'),
		changed: true,
		sentence: 'Bigsby is out.'
	},
	{
		slot: 'FLEX',
		ours: player('4', 'Jauan Jennings'),
		host: null,
		changed: true,
		sentence: 'An empty spot.'
	}
];

void test('the move is each changed slot: the player in and the starter out, for the week read', () => {
	assert.deepEqual(lineupMove({ week: 7, slots }), {
		kind: 'lineup',
		week: 7,
		changes: [
			{ slot: 'RB', in: '2', out: '3' },
			{ slot: 'FLEX', in: '4', out: null }
		]
	});
});

void test('the verb sets the lineup on the host only when the API opens the move and there is a change', () => {
	const open = { lineup: 'available' as const, note: null };
	const closed = { lineup: 'unavailable' as const, note: null };
	assert.equal(setsOnHost({ set: false, slots, moves: open }), true);
	assert.equal(setsOnHost({ set: false, slots, moves: closed }), false);
	assert.equal(setsOnHost({ set: true, slots: [], moves: open }), false);
	assert.equal(setsOnHost({ set: false, slots: slots.slice(0, 1), moves: open }), false);
});

const ready: HostMovePlan = {
	status: 'ready',
	sentence:
		'Start Rachaad White over Tank Bigsby at RB, and Jauan Jennings in the flex, on ESPN now.',
	confirm: 'token',
	expires_at: '2026-10-18T15:10:00Z',
	host_url: 'https://fantasy.espn.com/football/team?leagueId=1&teamId=3'
};

void test('a ready plan is the move to confirm, any other is the host page with the API sentence', () => {
	assert.deepEqual(planStep(ready), { kind: 'confirm', plan: { ...ready, confirm: 'token' } });
	assert.deepEqual(
		planStep({
			...ready,
			status: 'unavailable',
			confirm: null,
			sentence: 'Make this change on ESPN.'
		}),
		{ kind: 'unavailable', sentence: 'Make this change on ESPN.', href: ready.host_url }
	);
	assert.equal(planStep({ ...ready, confirm: null }).kind, 'unavailable');
});

void test('an answer is what the move came to, an unavailable one is the host page', () => {
	const refused: HostMoveResult = {
		outcome: 'refused',
		sentence: 'ESPN did not make the move, so nothing changed there.',
		host_words: 'Lineup transaction could not be completed, Alexander Mattison is locked',
		host_url: ready.host_url,
		move_id: '6f1d1c52-2626-4a26-9a26-000000000035'
	};
	assert.deepEqual(resultStep(refused), { kind: 'answered', result: refused });
	assert.deepEqual(
		resultStep({ ...refused, outcome: 'unavailable', host_words: null, move_id: null }),
		{
			kind: 'unavailable',
			sentence: refused.sentence,
			href: ready.host_url
		}
	);
});

void test("the host's reason is said in its own words under ours, ended once", () => {
	assert.equal(
		hostSaid('espn', 'Lineup transaction could not be completed, Alexander Mattison is locked'),
		'ESPN said: Lineup transaction could not be completed, Alexander Mattison is locked.'
	);
	assert.equal(
		hostSaid('espn', ' Transaction type can only be executed in the current scoring period. '),
		'ESPN said: Transaction type can only be executed in the current scoring period.'
	);
	assert.equal(settingWords('espn'), 'Setting it on ESPN');
	assert.equal(openHostWords('espn'), 'Open ESPN');
	assert.equal(readingWords('espn'), 'Reading your lineup on ESPN');
	assert.equal(MOVE_LINES.notNow, 'Not now');
});
