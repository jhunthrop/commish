// The web reads the API's game_state first (Lane 178): on every line and scoreboard game of the shared
// fixtures, at each of the six fixture clocks the parity file names, the screen's state and words are
// the same with the field as without it (the web's own computation), and the field holds the parity
// file's state and word. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { PlayerLine, Scoreboard } from '../inseason/api.ts';
import { bugsOf } from '../home/home.ts';
import { boxRow, gameOf } from './box.ts';
import { lineState, scoreboardHead } from './kickoff.ts';

const ROOT = new URL('../../../../../', import.meta.url);
const ZONE = 'America/Chicago';
/** A page whose clock runs past the answer's: an hour on, a cached read the page turns itself. */
const LATER_MS = 60 * 60_000;

interface ParityRow {
	route: string;
	clock: string;
	fixture: string;
	player_id: string | null;
	game: number | null;
	state: string;
	word: string;
}

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, ROOT), 'utf8'));
const rows = (read('shared/fixtures/parity/game-state.json') as { rows: ParityRow[] }).rows;
const dataOf = (fixture: string): unknown => (read(fixture) as { data: unknown }).data;

/** Every player line an answer carries, wherever it sits (slots, bench, reserve). */
function linesIn(body: unknown): PlayerLine[] {
	if (Array.isArray(body)) return body.flatMap(linesIn);
	if (body === null || typeof body !== 'object') return [];
	const own = 'player' in body && 'facts' in body ? [body as PlayerLine] : [];
	return [...own, ...Object.values(body).flatMap(linesIn)];
}

/** The line or game as an older API sends it: no game_state. */
function bare<T extends { game_state?: unknown }>(value: T): T {
	return { ...value, game_state: undefined };
}

const lineRows = rows.filter((r) => r.player_id !== null);
const gameRows = rows.filter((r) => r.game !== null);

void test('the parity file covers the six fixture clocks, lines and scoreboard games', () => {
	assert.equal(new Set(rows.map((r) => r.clock)).size, 6);
	assert.ok(lineRows.length > 0 && gameRows.length > 0);
});

void test('every fixture line reads the same state and words with the field as without it', () => {
	for (const row of lineRows) {
		const lines = linesIn(dataOf(row.fixture)).filter((l) => l.player.host_id === row.player_id);
		assert.ok(lines.length > 0, `${row.fixture} holds ${String(row.player_id)}`);
		for (const line of lines) {
			const at = `${row.fixture} ${line.player.host_id}`;
			assert.deepEqual(line.game_state, { state: row.state, word: row.word }, at);
			for (const now of [Date.parse(row.clock), Date.parse(row.clock) + LATER_MS]) {
				assert.equal(lineState(line, now), lineState(bare(line), now), at);
				assert.deepEqual(
					gameOf(line, line.player.team, ZONE, now),
					gameOf(bare(line), line.player.team, ZONE, now),
					at
				);
				assert.deepEqual(
					boxRow(line, '', ZONE, true, now),
					boxRow(bare(line), '', ZONE, true, now),
					at
				);
			}
		}
	}
});

void test('every fixture scoreboard game reads the same head and words with the field as without it', () => {
	const sync = { teams: [], me: -1 };
	for (const row of gameRows) {
		const board = dataOf(row.fixture) as Scoreboard;
		const game = board.games[row.game ?? -1];
		assert.ok(game !== undefined, `${row.fixture} holds game ${String(row.game)}`);
		const at = `${row.fixture} game ${String(row.game)}`;
		assert.deepEqual(game.game_state, { state: row.state, word: row.word }, at);
		const older = bare(game);
		for (const now of [Date.parse(row.clock), Date.parse(row.clock) + LATER_MS]) {
			assert.deepEqual(scoreboardHead(game, now), scoreboardHead(older, now), at);
			assert.deepEqual(
				bugsOf({ games: [game] }, sync, now, ZONE),
				bugsOf({ games: [older] }, sync, now, ZONE),
				at
			);
		}
	}
});
