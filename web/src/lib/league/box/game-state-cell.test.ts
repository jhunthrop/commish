// A game's state and word in the wire's terms (Lane 176): run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineCell, scoreboardCell, type StatedLine } from './game-state-cell.ts';

const KICKOFF_AT = '2026-10-18T17:00:00.000Z';
const kickoff = Date.parse(KICKOFF_AT);
const MINUTE = 60_000;

type Facts = StatedLine['facts'];
const line = (over: Partial<Facts>, team = 'BUF'): StatedLine => ({
	player: { team },
	facts: { bye: false, kickoff: KICKOFF_AT, played: false, game_state: 'upcoming', ...over }
});

void test('a line reads not started, kicked off and final by the clock and the API state', () => {
	assert.deepEqual(lineCell(line({}), kickoff - MINUTE), {
		state: 'not_started',
		word: 'Next kickoff'
	});
	// An upcoming read that lags the clock is kicked off, as the score bug says.
	assert.deepEqual(lineCell(line({}), kickoff), { state: 'kicked_off', word: 'Kicked off' });
	assert.deepEqual(lineCell(line({ game_state: 'kicked_off' }), kickoff + MINUTE), {
		state: 'kicked_off',
		word: 'Kicked off'
	});
	assert.deepEqual(lineCell(line({ game_state: 'final', played: true }), kickoff), {
		state: 'final',
		word: 'Final'
	});
	// An older answer with no state is final when played.
	assert.equal(lineCell(line({ game_state: undefined, played: true }), kickoff).state, 'final');
});

void test('a bye and a line with no game are named, a free agent by the box score word', () => {
	assert.deepEqual(lineCell(line({ bye: true, kickoff: null, game_state: null }), kickoff), {
		state: 'bye',
		word: 'Bye'
	});
	assert.deepEqual(lineCell(line({ kickoff: null, game_state: null }, 'FA'), kickoff), {
		state: 'no_game',
		word: 'No club'
	});
	assert.deepEqual(lineCell(line({ kickoff: null, game_state: null }), kickoff), {
		state: 'no_game',
		word: ''
	});
});

void test('a scoreboard game reads by its head: next kickoff, kicked off, final', () => {
	assert.deepEqual(
		scoreboardCell({ state: 'upcoming', next_kickoff: KICKOFF_AT }, kickoff - MINUTE),
		{
			state: 'not_started',
			word: 'Next kickoff'
		}
	);
	assert.equal(
		scoreboardCell({ state: 'upcoming', next_kickoff: KICKOFF_AT }, kickoff).state,
		'kicked_off'
	);
	assert.deepEqual(scoreboardCell({ state: 'upcoming', next_kickoff: null }, kickoff), {
		state: 'not_started',
		word: ''
	});
	assert.equal(
		scoreboardCell({ state: 'playing', next_kickoff: KICKOFF_AT }, kickoff - MINUTE).state,
		'kicked_off'
	);
	assert.deepEqual(scoreboardCell({ state: 'final', next_kickoff: null }, kickoff), {
		state: 'final',
		word: 'Final'
	});
});
