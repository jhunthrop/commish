/** The game-state parity (Lane 176, spec §5.1): what the web's own game-state readers print for every
 * line of the fixture league's lineup and every game of its scoreboard at each fixture clock, as rows
 * of `{ route, clock, fixture, player_id, game, state, word }`. The API serves the same state and word
 * on the wire (`game_state` on PlayerLine and ScoreboardGame), and a Go test in api/internal/inseason
 * reads this file and the fixture answers it names, so the API's rule cannot drift from the web's.
 *
 * The web's readers return upcoming, kicked_off or final, and null with no game; the wire's open enum
 * names the two nulls (bye, no_game) and says not_started for upcoming. The words are the web's own:
 * the KICKOFF table's, with the box score's Bye and No club, and the League page's "Next kickoff" under
 * a game still to come. Written by export-parity.ts beside the League home's parity. */
import { BOX } from '../../web/src/lib/league/box/box.ts';
import { gameHead, KICKOFF, lineState } from '../../web/src/lib/league/box/kickoff.ts';
import { isFreeAgent } from '../../web/src/lib/format/free-agent.ts';
import type { PlayerLine, Scoreboard } from '../../web/src/lib/league/inseason/api.ts';

export const GAME_STATE_OUTPUT = 'shared/fixtures/parity/game-state.json';

/** The wire's states (api/openapi.yaml GameStateCell.state). */
export type WireState = 'not_started' | 'kicked_off' | 'final' | 'bye' | 'no_game';

export interface WireGameState {
	state: WireState;
	word: string;
}

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
	state: WireState;
	word: string;
}

/** A line's game at `now` by the web's lineState, in the wire's terms: Bye on a bye, No club for a
 * free agent and no word for any other line with no game held (BoxGame.svelte's cells). */
export function lineWire(line: Pick<PlayerLine, 'facts' | 'player'>, now: number): WireGameState {
	const state = lineState(line.facts, now);
	if (state === null) {
		if (line.facts.bye) return { state: 'bye', word: BOX.bye };
		return { state: 'no_game', word: isFreeAgent(line.player.team) ? BOX.noClub : '' };
	}
	if (state === 'final') return { state, word: KICKOFF.final };
	if (state === 'kicked_off') return { state, word: KICKOFF.kickedOff };
	return { state: 'not_started', word: KICKOFF.next };
}

/** A scoreboard game's head at `now` by the web's gameHead (home.ts bugHead's words): "Next kickoff"
 * under a game still to come with a kickoff to name, nothing with none. */
export function scoreboardWire(game: Scoreboard['games'][number], now: number): WireGameState {
	const head = gameHead({ state: game.state, next: game.next_kickoff }, now);
	if (head.state === 'final') return { state: 'final', word: KICKOFF.final };
	if (head.state === 'kicked_off') return { state: 'kicked_off', word: KICKOFF.kickedOff };
	return { state: 'not_started', word: head.next === null ? '' : KICKOFF.next };
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

/** A lineup answer's rows: each player once, by his platform id; a player the answer carries twice
 * with two different reads fails, as the API would never send him so. */
export function lineupRows(source: StateSource, lineup: unknown): GameStateRow[] {
	const now = Date.parse(source.clock);
	const byPlayer = new Map<string, WireGameState>();
	for (const line of linesIn(lineup)) {
		const read = lineWire(line, now);
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
		...scoreboardWire(game, now)
	}));
}

/** The parity file: its about line and every row. */
export function renderGameState(about: string, rows: readonly GameStateRow[]): string {
	return `${JSON.stringify({ about, rows }, null, '\t')}\n`;
}
