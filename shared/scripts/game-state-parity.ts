/** The game-state parity (Lane 176, spec §5.1): what the web's own game-state readers print for every
 * line of the fixture league's lineup and waivers and every game of its scoreboard at each fixture
 * clock, as rows of `{ route, clock, fixture, player_id, game, state, word }`. The API serves the same
 * state and word on the wire (`game_state` on PlayerLine and ScoreboardGame), and a Go test in
 * api/internal/inseason reads this file and the fixture answers it names, so the API's rule cannot
 * drift from the web's. The rule in the wire's terms is the web's game-state-cell.ts (lineState and
 * gameHead with the web's words). Written by export-parity.ts beside the League home's parity. */
import {
	lineCell,
	scoreboardCell,
	type GameStateCell
} from '../../web/src/lib/league/box/game-state-cell.ts';
import type { PlayerLine, Scoreboard } from '../../web/src/lib/league/inseason/api.ts';

export const GAME_STATE_OUTPUT = 'shared/fixtures/parity/game-state.json';

/** One fixture answer the rows are read from: its route, its clock and its file. */
export interface StateSource {
	route: string;
	clock: string;
	fixture: string;
}

export interface GameStateRow extends StateSource {
	/** The line's player (his platform id), null for a scoreboard game. */
	player_id: string | null;
	/** The scoreboard game's index in the answer, null for a line. */
	game: number | null;
	state: GameStateCell['state'];
	word: string;
}

/** Every player line an answer carries, wherever it sits (slots, bench, reserve, pickups): an object
 * with a player and his facts. */
export function linesIn(body: unknown): PlayerLine[] {
	if (Array.isArray(body)) return body.flatMap(linesIn);
	if (body === null || typeof body !== 'object') return [];
	const node = body as Record<string, unknown>;
	const own = 'player' in node && 'facts' in node ? [node as unknown as PlayerLine] : [];
	return [...own, ...Object.values(node).flatMap(linesIn)];
}

/** An answer's line rows: each player once, by his platform id; a player the answer carries twice
 * with two different reads fails, as the API would never send him so. */
export function lineRows(source: StateSource, body: unknown): GameStateRow[] {
	const now = Date.parse(source.clock);
	const byPlayer = new Map<string, GameStateCell>();
	for (const line of linesIn(body)) {
		const read = lineCell(line, now);
		const id = line.player.host_id;
		const held = byPlayer.get(id);
		if (held !== undefined && (held.state !== read.state || held.word !== read.word))
			throw new Error(`${source.fixture} reads ${id} two ways.`);
		byPlayer.set(id, read);
	}
	return [...byPlayer]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([id, read]) => ({ ...source, player_id: id, game: null, ...read }));
}

/** A scoreboard answer's rows: each game by its index. */
export function scoreboardRows(source: StateSource, board: Scoreboard): GameStateRow[] {
	const now = Date.parse(source.clock);
	return board.games.map((game, i) => ({
		...source,
		player_id: null,
		game: i,
		...scoreboardCell(game, now)
	}));
}

/** The parity file: its about line and every row. */
export function renderGameState(about: string, rows: readonly GameStateRow[]): string {
	return `${JSON.stringify({ about, rows }, null, '\t')}\n`;
}
