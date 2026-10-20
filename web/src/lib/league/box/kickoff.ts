/** A week game's head (Lane 85), one rule for the League page's score bugs and the Matchup strip: the
 * API's state (gameStateAt, carried on the scoreboard and on every player's facts), and a next
 * kickoff only while it is still to come at the page's clock. A read that lags the clock (its next
 * kickoff already past) reads Kicked off, never "Next kickoff" for a game played. Pure, tested in
 * kickoff.test.ts. */
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

export function gameHead(read: GameRead, now: number): GameHead {
	if (read.state === 'final') return { state: 'final', next: null };
	const ahead = read.next !== null && Date.parse(read.next) > now ? read.next : null;
	if (read.state === 'playing') return { state: 'kicked_off', next: ahead };
	if (read.next === null) return { state: 'upcoming', next: null };
	return ahead === null ? { state: 'kicked_off', next: null } : { state: 'upcoming', next: ahead };
}

/** A player's game as his line carries it: the API's state, its kickoff, a bye. */
export type LineGame = StatedGame & { bye: boolean };

/** One player's game by the same rule (gameHead) at the page's clock (Lane 85 fix round, H1): the API's
 * state, upcoming read as kicked off once its kickoff has passed, so a lineup read that lags the
 * scoreboard's never offers a move the score bug calls kicked off. A read with no state (an older
 * answer) is final when played. Null for a bye or a game with no kickoff held. */
export function lineState(game: LineGame, now: number): GameHead['state'] | null {
	if (game.bye || game.kickoff === null) return null;
	const api = gameStateOf(game) ?? (game.played ? 'final' : 'upcoming');
	return gameHead({ state: api === 'kicked_off' ? 'playing' : api, next: game.kickoff }, now).state;
}

/** Still to be played at the page's clock, by lineState. */
export function toPlay(game: LineGame, now: number): boolean {
	return lineState(game, now) === 'upcoming';
}

/** A week's lineup can still be set at the page's clock (Lane 100, B64): its last game is still to
 * kick off, by gameHead. */
export function lineupOpen(lastKickoff: string, now: number): boolean {
	return gameHead({ state: 'upcoming', next: lastKickoff }, now).state === 'upcoming';
}

/** Past its kickoff at the page's clock, by lineState: no platform takes a move on him. */
export function pastKickoff(game: LineGame, now: number): boolean {
	const state = lineState(game, now);
	return state === 'kicked_off' || state === 'final';
}

/** A set of games (a matchup's starters) as one read for gameHead: final once every one is, under way
 * once any has kicked off, the earliest kickoff still to come next; each game by lineState. */
export function linesRead(games: readonly LineGame[], now: number): GameRead {
	const states = games.flatMap((g) => {
		const state = lineState(g, now);
		return state === null || g.kickoff === null ? [] : [{ state, at: g.kickoff }];
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
