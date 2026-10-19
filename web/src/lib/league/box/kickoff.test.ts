// A week game's head, one rule for the League page's score bugs and the Matchup strip (Lane 85): run
// with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gameHead, KICKOFF } from './kickoff.ts';

const SUNDAY_NOON = '2026-10-18T17:00:00.000Z';
const SATURDAY = Date.parse('2026-10-17T17:00:00.000Z');
const MONDAY = Date.parse('2026-10-19T16:00:00.000Z');

void test('the API says final: Final, and no kickoff is next', () => {
	assert.deepEqual(gameHead({ state: 'final', next: null }, MONDAY), {
		state: 'final',
		next: null
	});
	assert.deepEqual(gameHead({ state: 'final', next: SUNDAY_NOON }, SATURDAY), {
		state: 'final',
		next: null
	});
});

void test('a kickoff still to come is next, before any game and between them', () => {
	assert.deepEqual(gameHead({ state: 'upcoming', next: SUNDAY_NOON }, SATURDAY), {
		state: 'upcoming',
		next: SUNDAY_NOON
	});
	assert.deepEqual(gameHead({ state: 'playing', next: SUNDAY_NOON }, SATURDAY), {
		state: 'kicked_off',
		next: SUNDAY_NOON
	});
});

void test('a kickoff before the page clock is never next: a lagging read reads Kicked off', () => {
	assert.deepEqual(gameHead({ state: 'upcoming', next: SUNDAY_NOON }, MONDAY), {
		state: 'kicked_off',
		next: null
	});
	assert.deepEqual(gameHead({ state: 'playing', next: SUNDAY_NOON }, MONDAY), {
		state: 'kicked_off',
		next: null
	});
	// At the kickoff itself the game has kicked off.
	assert.deepEqual(gameHead({ state: 'upcoming', next: SUNDAY_NOON }, Date.parse(SUNDAY_NOON)), {
		state: 'kicked_off',
		next: null
	});
});

void test('a game with no kickoff held stays upcoming, with nothing next', () => {
	assert.deepEqual(gameHead({ state: 'upcoming', next: null }, MONDAY), {
		state: 'upcoming',
		next: null
	});
});

void test('the words are the game state words, one source for every screen', () => {
	assert.equal(KICKOFF.kickedOff, 'Kicked off');
	assert.equal(KICKOFF.final, 'Final');
	assert.equal(KICKOFF.next, 'Next kickoff');
	assert.equal(KICKOFF.first, 'First kickoff');
});
