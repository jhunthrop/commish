// A week game's head, one rule for the League page's score bugs and the Matchup strip (Lane 85): run
// with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
	gameHead,
	KICKOFF,
	lineState,
	linesRead,
	pastKickoff,
	scoreboardHead,
	stateWord,
	toPlay,
	type GameLine
} from './kickoff.ts';

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

void test('one ms before its kickoff a game is still to come, at its kickoff it has kicked off', () => {
	const before = Date.parse(SUNDAY_NOON) - 1;
	assert.deepEqual(gameHead({ state: 'upcoming', next: SUNDAY_NOON }, before), {
		state: 'upcoming',
		next: SUNDAY_NOON
	});
	const line = {
		facts: { bye: false, played: false, kickoff: SUNDAY_NOON, game_state: 'upcoming' as const }
	};
	assert.equal(lineState(line, before), 'upcoming');
	assert.equal(toPlay(line, before), true);
	assert.equal(lineState(line, Date.parse(SUNDAY_NOON)), 'kicked_off');
	assert.equal(pastKickoff(line, Date.parse(SUNDAY_NOON)), true);
});

void test('a line reads by the same head: the API state, a lagging upcoming kicked off by the clock', () => {
	const at = (game_state: 'upcoming' | 'kicked_off' | 'final' | null, played = false) => ({
		facts: { bye: false, played, kickoff: SUNDAY_NOON, game_state }
	});
	assert.equal(lineState(at('upcoming'), MONDAY), 'kicked_off');
	assert.equal(lineState(at('kicked_off'), SATURDAY), 'kicked_off');
	assert.equal(lineState(at('final', true), MONDAY), 'final');
	assert.equal(lineState(at(null, true), MONDAY), 'final');
	assert.equal(lineState(at(null), SATURDAY), 'upcoming');
	assert.equal(lineState({ facts: { ...at('upcoming').facts, bye: true } }, MONDAY), null);
	assert.equal(lineState({ facts: { ...at('upcoming').facts, kickoff: null } }, MONDAY), null);
	// A matchup's starters gathered once: under way with the late game next, then final.
	const late = { facts: { ...at('upcoming').facts, kickoff: '2026-10-18T20:25:00.000Z' } };
	const noon = Date.parse(SUNDAY_NOON) + 1;
	assert.deepEqual(linesRead([at('upcoming'), late], noon), {
		state: 'playing',
		next: '2026-10-18T20:25:00.000Z'
	});
	assert.deepEqual(
		linesRead(
			[at('final', true), { facts: { ...late.facts, game_state: 'final', played: true } }],
			MONDAY
		),
		{
			state: 'final',
			next: null
		}
	);
});

void test('still to play by the one rule: the API state, the clock past a lagging upcoming (H-A)', () => {
	const kickoff = SUNDAY_NOON;
	const before = Date.parse(kickoff) - 60_000;
	// A kicked-off state wins whatever the browser clock says.
	assert.equal(
		toPlay({ facts: { bye: false, game_state: 'kicked_off', played: false, kickoff } }, before),
		false
	);
	// A read with no state: played is final, else the clock decides.
	assert.equal(toPlay({ facts: { bye: false, played: true, kickoff } }, before), false);
	assert.equal(toPlay({ facts: { bye: false, played: false, kickoff } }, before), true);
	assert.equal(
		toPlay({ facts: { bye: false, played: false, kickoff } }, Date.parse(kickoff)),
		false
	);
	// No game held is nothing to play.
	assert.equal(toPlay({ facts: { bye: false, played: false, kickoff: null } }, before), false);
});

/** A line the API stamped (Lane 176): an upcoming read by its facts, with the given field. */
const stamped = (game_state: GameLine['game_state']): GameLine => ({
	facts: { bye: false, played: false, kickoff: SUNDAY_NOON, game_state: 'upcoming' },
	game_state
});
/** A state a later API may send that this web does not know (the field's enum is open). */
const UNKNOWN = { state: 'delayed', word: 'Delayed' } as unknown as GameLine['game_state'];

void test('a line reads the API field first: its state over the facts (Lane 178)', () => {
	assert.equal(lineState(stamped({ state: 'final', word: 'Final' }), SATURDAY), 'final');
	assert.equal(
		lineState(stamped({ state: 'kicked_off', word: 'Kicked off' }), SATURDAY),
		'kicked_off'
	);
	assert.equal(
		lineState(stamped({ state: 'not_started', word: 'Next kickoff' }), SATURDAY),
		'upcoming'
	);
	assert.equal(lineState(stamped({ state: 'bye', word: 'Bye' }), SATURDAY), null);
	assert.equal(lineState(stamped({ state: 'no_game', word: '' }), SATURDAY), null);
	assert.equal(toPlay(stamped({ state: 'final', word: 'Final' }), SATURDAY), false);
	assert.equal(pastKickoff(stamped({ state: 'kicked_off', word: 'Kicked off' }), SATURDAY), true);
});

void test('the field read at the request clock still turns at the page clock past its kickoff', () => {
	// A cached answer from before kickoff: the page's clock is past it, so he has kicked off.
	assert.equal(
		lineState(stamped({ state: 'not_started', word: 'Next kickoff' }), MONDAY),
		'kicked_off'
	);
	assert.deepEqual(linesRead([stamped({ state: 'not_started', word: 'Next kickoff' })], MONDAY), {
		state: 'playing',
		next: null
	});
});

void test('a field state the web does not know falls back to the facts, never a guess', () => {
	assert.equal(lineState(stamped(UNKNOWN), SATURDAY), 'upcoming');
	assert.equal(lineState(stamped(UNKNOWN), MONDAY), 'kicked_off');
});

void test('a scoreboard game reads its field first, and its state and next kickoff without one', () => {
	const game = { state: 'upcoming' as const, next_kickoff: SUNDAY_NOON };
	assert.deepEqual(scoreboardHead(game, SATURDAY), { state: 'upcoming', next: SUNDAY_NOON });
	assert.deepEqual(scoreboardHead(game, MONDAY), { state: 'kicked_off', next: null });
	assert.deepEqual(
		scoreboardHead({ ...game, game_state: { state: 'final', word: 'Final' } }, SATURDAY),
		{
			state: 'final',
			next: null
		}
	);
	assert.deepEqual(
		scoreboardHead({ ...game, game_state: { state: 'kicked_off', word: 'Kicked off' } }, SATURDAY),
		{ state: 'kicked_off', next: SUNDAY_NOON }
	);
	assert.deepEqual(
		scoreboardHead({ ...game, game_state: { state: 'not_started', word: 'Next kickoff' } }, MONDAY),
		{ state: 'kicked_off', next: null }
	);
	assert.deepEqual(scoreboardHead({ ...game, game_state: UNKNOWN }, SATURDAY), {
		state: 'upcoming',
		next: SUNDAY_NOON
	});
});

void test('a state prints the field word when the field holds that state, the web word otherwise', () => {
	const final = { state: 'final', word: 'Final' } as const;
	assert.equal(stateWord(final, 'final', KICKOFF.final), 'Final');
	assert.equal(stateWord({ ...final, word: 'Over' }, 'final', KICKOFF.final), 'Over');
	// The page clock moved him on from the field's state: the web's word for the state shown.
	assert.equal(
		stateWord({ state: 'not_started', word: 'Next kickoff' }, 'kicked_off', KICKOFF.kickedOff),
		'Kicked off'
	);
	assert.equal(stateWord(undefined, 'upcoming', KICKOFF.next), 'Next kickoff');
});
