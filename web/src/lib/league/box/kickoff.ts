/** A week game's head (Lane 85), one rule for the League page's score bugs and the Matchup strip: the
 * API's state, and a next kickoff only while it is still to come at the page's clock. A read that lags
 * the clock (its next kickoff already past) reads Kicked off, never "Next kickoff" for a game played.
 * The API's state is its `game_state` field (Lane 176, `{ state, word }` on every PlayerLine and
 * ScoreboardGame) when the answer carries it, read first (Lane 178) so the web, iOS and Android say a
 * game one way; an older or cached answer without it reads by the facts as before (factsState), and
 * the two agree on every shared fixture line (game-state-reader.test.ts). Pure, tested in
 * kickoff.test.ts. */
import type { components } from '#lib/api/types.ts';
import { GAME_STATE_WORDS, gameStateOf, type StatedGame } from '#lib/format/game-facts.ts';
import type { Scoreboard } from '../inseason/api.ts';

/** Every word a game's head prints, the state words the rows print (GAME_STATE_WORDS). */
export const KICKOFF = {
	next: 'Next kickoff',
	first: 'First kickoff',
	kickedOff: GAME_STATE_WORDS.kicked_off,
	final: GAME_STATE_WORDS.final,
	/** The Matchup bug's state while the side behind has nobody left to score (the API's decided,
	 * Lane 99 B31). */
	decided: 'Decided'
} as const;

/** A game's state and word as the API sends them at its clock (Lane 176). */
export type GameStateCell = components['schemas']['GameStateCell'];

/** A game's state as the API reads it: the scoreboard's, or one gathered from its starters' lines. */
export interface GameRead {
	state: Scoreboard['games'][number]['state'];
	/** The earliest kickoff the read holds still to come, null when it holds none. */
	next: string | null;
}

/** The head a game shows: upcoming before any of its games, kicked off once one has (until every one
 * is final), final; the next kickoff still to come, null with none. */
export interface GameHead {
	state: 'upcoming' | 'kicked_off' | 'final';
	next: string | null;
}

/** The field's states that name a game, as gameHead reads them; bye and no_game name none. A state
 * this web does not know (the enum is open) is in neither, and the facts decide. */
const READ_OF_CELL: Readonly<Partial<Record<string, GameRead['state']>>> = {
	not_started: 'upcoming',
	kicked_off: 'playing',
	final: 'final'
};
const NO_GAME_CELLS: ReadonlySet<string> = new Set(['bye', 'no_game']);

/** The field's state for each head, to tell whether the field holds the state a screen shows. */
const CELL_OF_HEAD: Readonly<Record<GameHead['state'], GameStateCell['state']>> = {
	upcoming: 'not_started',
	kicked_off: 'kicked_off',
	final: 'final'
};

export function gameHead(read: GameRead, now: number): GameHead {
	if (read.state === 'final') return { state: 'final', next: null };
	const ahead = read.next !== null && Date.parse(read.next) > now ? read.next : null;
	if (read.state === 'playing') return { state: 'kicked_off', next: ahead };
	if (read.next === null) return { state: 'upcoming', next: null };
	return ahead === null ? { state: 'kicked_off', next: null } : { state: 'upcoming', next: ahead };
}

/** A scoreboard game as its head reads it: the API's state and next kickoff, and its field. */
export type HeadGame = Pick<Scoreboard['games'][number], 'state' | 'next_kickoff' | 'game_state'>;

/** A scoreboard game's head at the page's clock by gameHead: the field's state when the answer
 * carries one this web knows, else the game's own state; its next kickoff either way, so a read that
 * lags the clock still turns. */
export function scoreboardHead(game: HeadGame, now: number): GameHead {
	const fromCell = game.game_state === undefined ? undefined : READ_OF_CELL[game.game_state.state];
	return gameHead({ state: fromCell ?? game.state, next: game.next_kickoff }, now);
}

/** A player's game as his line carries it: the API's state, its kickoff, a bye. */
export type LineGame = StatedGame & { bye: boolean };

/** A player's line as the rule reads it: his week's facts, and the API's field when it sends one. */
export interface GameLine {
	facts: LineGame;
	game_state?: GameStateCell;
}

/** One player's game by his facts (gameHead) at the page's clock (Lane 85 fix round, H1): the API's
 * state, upcoming read as kicked off once its kickoff has passed, so a lineup read that lags the
 * scoreboard's never offers a move the score bug calls kicked off. A read with no state (an older
 * answer) is final when played. Null for a bye or a game with no kickoff held. The rule an answer
 * without the field reads by (lineState), and the one the fixture API stamps the field with
 * (game-state-cell.ts). */
export function factsState(game: LineGame, now: number): GameHead['state'] | null {
	if (game.bye || game.kickoff === null) return null;
	const api = gameStateOf(game) ?? (game.played ? 'final' : 'upcoming');
	return gameHead({ state: api === 'kicked_off' ? 'playing' : api, next: game.kickoff }, now).state;
}

/** One player's game at the page's clock, the one rule every screen reads (Lane 178): the API's field
 * first, null on its bye or no game, else its state by gameHead with his kickoff, so a cached read
 * still turns at kickoff; by his facts (factsState) when the answer carries no field or a state this
 * web does not know. */
export function lineState(line: GameLine, now: number): GameHead['state'] | null {
	const cell = line.game_state;
	if (cell === undefined) return factsState(line.facts, now);
	if (NO_GAME_CELLS.has(cell.state)) return null;
	const read = READ_OF_CELL[cell.state];
	if (read === undefined) return factsState(line.facts, now);
	return gameHead({ state: read, next: line.facts.kickoff }, now).state;
}

/** The word a game's state prints: the field's word when the field holds the state shown, the web's
 * own word (`own`) otherwise (no field, or a page clock past the field's read). */
export function stateWord(
	cell: GameStateCell | undefined,
	state: GameHead['state'],
	own: string
): string {
	return cell?.state === CELL_OF_HEAD[state] ? cell.word : own;
}

/** Still to be played at the page's clock, by lineState. */
export function toPlay(line: GameLine, now: number): boolean {
	return lineState(line, now) === 'upcoming';
}

/** A week's lineup can still be set at the page's clock (Lane 100, B64): its last game is still to
 * kick off, by gameHead. */
export function lineupOpen(lastKickoff: string, now: number): boolean {
	return gameHead({ state: 'upcoming', next: lastKickoff }, now).state === 'upcoming';
}

/** Past its kickoff at the page's clock, by lineState: no platform takes a move on him. */
export function pastKickoff(line: GameLine, now: number): boolean {
	const state = lineState(line, now);
	return state === 'kicked_off' || state === 'final';
}

/** A set of games (a matchup's starters) as one read for gameHead: final once every one is, under way
 * once any has kicked off, the earliest kickoff still to come next; each game by lineState. */
export function linesRead(lines: readonly GameLine[], now: number): GameRead {
	const states = lines.flatMap((line) => {
		const state = lineState(line, now);
		const at = line.facts.kickoff;
		return state === null || at === null ? [] : [{ state, at }];
	});
	const ahead = states
		.filter((g) => g.state === 'upcoming')
		.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	const state =
		states.length > 0 && states.every((g) => g.state === 'final')
			? 'final'
			: ahead.length < states.length
				? 'playing'
				: 'upcoming';
	return { state, next: ahead[0]?.at ?? null };
}
