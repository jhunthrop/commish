/** A week game's head (Lane 85), one rule for the League page's score bugs and the Matchup strip: the
 * API's state (gameStateAt, carried on the scoreboard and on every player's facts), and a next
 * kickoff only while it is still to come at the page's clock. A read that lags the clock (its next
 * kickoff already past) reads Kicked off, never "Next kickoff" for a game played. Pure, tested in
 * kickoff.test.ts. */
import { GAME_STATE_WORDS } from '#lib/format/game-facts.ts';
import type { Scoreboard } from '../inseason/api.ts';

/** Every word a game's head prints, the state words the rows print (GAME_STATE_WORDS). */
export const KICKOFF = {
	next: 'Next kickoff',
	first: 'First kickoff',
	kickedOff: GAME_STATE_WORDS.kicked_off,
	final: GAME_STATE_WORDS.final
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
