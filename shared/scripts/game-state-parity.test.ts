// The game-state parity (game-state-parity.ts): the rows export-parity.ts writes over the fixtures,
// and the fixtures' own game_state, stamped by the fixture API by the same rule. The rule itself is
// tested in web/src/lib/league/box/game-state-cell.test.ts. Run with
// `node --test shared/scripts/*.test.ts`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CLOCKS, generate, instantOf } from './export-parity.ts';
import { REPOSITORY } from './generated.ts';
import { GAME_STATE_OUTPUT, linesIn, type GameStateRow } from './game-state-parity.ts';

const rowsOf = async (): Promise<GameStateRow[]> =>
	(JSON.parse((await generate()).get(GAME_STATE_OUTPUT) ?? '{}') as { rows: GameStateRow[] }).rows;

void test('every line an answer carries is found, nested or in a list', () => {
	const a = { player: { host_id: '1', team: 'BUF' }, facts: { bye: true } };
	assert.equal(linesIn({ slots: [{ line: a }], bench: [a], week: 6 }).length, 2);
});

void test('the rows hold every clock, the lineup and the scoreboard, and four states', async () => {
	const rows = await rowsOf();
	const clocks = [...new Set(rows.map((r) => r.clock))];
	assert.deepEqual(clocks, CLOCKS.map(instantOf));
	for (const clock of clocks) {
		const at = rows.filter((r) => r.clock === clock);
		assert.ok(
			at.some((r) => r.route.endsWith('/lineup') && r.player_id !== null),
			clock
		);
		assert.ok(
			at.some((r) => r.route.endsWith('/scoreboard') && r.game !== null),
			clock
		);
	}
	const states = new Set(rows.map((r) => r.state));
	for (const state of ['not_started', 'kicked_off', 'final', 'bye'] as const)
		assert.ok(states.has(state), state);
});

void test('the fixture answers carry the game_state each row reads, as the API sends it', async () => {
	for (const row of await rowsOf()) {
		const body = (
			JSON.parse(readFileSync(join(REPOSITORY, row.fixture), 'utf8')) as { data: unknown }
		).data;
		const cells =
			row.game !== null
				? [(body as { games: { game_state?: unknown }[] }).games[row.game]?.game_state]
				: linesIn(body)
						.filter((l) => l.player.host_id === row.player_id)
						.map((l) => l.game_state);
		assert.ok(cells.length > 0, `${row.fixture} ${String(row.player_id ?? row.game)}`);
		for (const cell of cells)
			assert.deepEqual(cell, { state: row.state, word: row.word }, row.fixture);
	}
});
