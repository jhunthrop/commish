// The game-state parity (game-state-parity.ts): the web's readers in the wire's terms, and the rows
// export-parity.ts writes over the fixtures. Run with `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CLOCKS, generate, instantOf } from './export-parity.ts';
import {
	GAME_STATE_OUTPUT,
	lineWire,
	linesIn,
	scoreboardWire,
	type GameStateRow
} from './game-state-parity.ts';

const KICKOFF_AT = '2026-10-18T17:00:00.000Z';
const kickoff = Date.parse(KICKOFF_AT);
const MINUTE = 60_000;

type Line = Parameters<typeof lineWire>[0];
type Facts = Line['facts'];
type Game = Parameters<typeof scoreboardWire>[0];

const facts = (over: Partial<Facts>): Facts =>
	({ bye: false, kickoff: KICKOFF_AT, played: false, game_state: 'upcoming', ...over }) as Facts;
const line = (over: Partial<Facts>, team = 'BUF'): Line =>
	({ player: { host_id: '1', name: 'A', position: 'WR', team }, facts: facts(over) }) as Line;
const game = (state: Game['state'], next: string | null): Game =>
	({ state, next_kickoff: next, sides: [] }) as unknown as Game;

void test('a line reads not started, kicked off and final by the clock and the API state', () => {
	assert.deepEqual(lineWire(line({}), kickoff - MINUTE), {
		state: 'not_started',
		word: 'Next kickoff'
	});
	// An upcoming read that lags the clock is kicked off, as the score bug says.
	assert.deepEqual(lineWire(line({}), kickoff), { state: 'kicked_off', word: 'Kicked off' });
	assert.deepEqual(lineWire(line({ game_state: 'kicked_off' }), kickoff + MINUTE), {
		state: 'kicked_off',
		word: 'Kicked off'
	});
	assert.deepEqual(lineWire(line({ game_state: 'final', played: true }), kickoff), {
		state: 'final',
		word: 'Final'
	});
	// An older answer with no state is final when played.
	assert.equal(lineWire(line({ game_state: undefined, played: true }), kickoff).state, 'final');
});

void test('a bye and a line with no game are named, a free agent by the box score word', () => {
	assert.deepEqual(lineWire(line({ bye: true, kickoff: null, game_state: null }), kickoff), {
		state: 'bye',
		word: 'Bye'
	});
	assert.deepEqual(lineWire(line({ kickoff: null, game_state: null }, 'FA'), kickoff), {
		state: 'no_game',
		word: 'No club'
	});
	assert.deepEqual(lineWire(line({ kickoff: null, game_state: null }), kickoff), {
		state: 'no_game',
		word: ''
	});
});

void test('a scoreboard game reads by its head: next kickoff, kicked off, final', () => {
	assert.deepEqual(scoreboardWire(game('upcoming', KICKOFF_AT), kickoff - MINUTE), {
		state: 'not_started',
		word: 'Next kickoff'
	});
	assert.equal(scoreboardWire(game('upcoming', KICKOFF_AT), kickoff).state, 'kicked_off');
	assert.deepEqual(scoreboardWire(game('upcoming', null), kickoff), {
		state: 'not_started',
		word: ''
	});
	assert.equal(scoreboardWire(game('playing', KICKOFF_AT), kickoff - MINUTE).state, 'kicked_off');
	assert.deepEqual(scoreboardWire(game('final', null), kickoff), { state: 'final', word: 'Final' });
});

void test('every line an answer carries is found, nested or in a list', () => {
	const a = line({});
	assert.equal(linesIn({ slots: [{ line: a }], bench: [a], week: 6 }).length, 2);
});

void test('the rows hold every clock, the lineup and the scoreboard, and four states', async () => {
	const file = JSON.parse((await generate()).get(GAME_STATE_OUTPUT) ?? '{}') as {
		rows: GameStateRow[];
	};
	const clocks = [...new Set(file.rows.map((r) => r.clock))];
	assert.deepEqual(clocks, CLOCKS.map(instantOf));
	for (const clock of clocks) {
		const at = file.rows.filter((r) => r.clock === clock);
		assert.ok(
			at.some((r) => r.route.endsWith('/lineup') && r.player_id !== null),
			clock
		);
		assert.ok(
			at.some((r) => r.route.endsWith('/scoreboard') && r.game !== null),
			clock
		);
	}
	const states = new Set(file.rows.map((r) => r.state));
	for (const state of ['not_started', 'kicked_off', 'final', 'bye'] as const)
		assert.ok(states.has(state), state);
});
