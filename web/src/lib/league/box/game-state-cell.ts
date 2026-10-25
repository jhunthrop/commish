/** A game's state and word as the API sends them on the wire (Lane 176, `game_state` on PlayerLine
 * and ScoreboardGame): the web's own computation, factsState and gameHead (kickoff.ts), in the wire's
 * terms. The fixture API stamps its answers with these, and shared/scripts/game-state-parity.ts writes
 * them as the parity file the API's Go test holds its rule to. The screens read the field first
 * (kickoff.ts lineState, Lane 178) and this computation only without it. Pure, tested in
 * game-state-cell.test.ts. */
import type { components } from '#lib/api/types.ts';
import { isFreeAgent } from '#lib/format/free-agent.ts';
import { BOX } from './box.ts';
import { factsState, gameHead, KICKOFF, type GameStateCell, type LineGame } from './kickoff.ts';

export type { GameStateCell };
type ScoreboardGame = components['schemas']['ScoreboardGame'];

/** A line as the rule reads it: his club and his week's game. */
export interface StatedLine {
	player: { team: string };
	facts: LineGame;
}

/** A line's game at `now` by its facts (factsState): Bye on a bye, No club for a free agent and no word for any
 * other line with no game held (BoxGame.svelte's cells), "Next kickoff" before his kickoff. */
export function lineCell(line: StatedLine, now: number): GameStateCell {
	const state = factsState(line.facts, now);
	if (state === null) {
		if (line.facts.bye) return { state: 'bye', word: BOX.bye };
		return { state: 'no_game', word: isFreeAgent(line.player.team) ? BOX.noClub : '' };
	}
	if (state === 'final') return { state, word: KICKOFF.final };
	if (state === 'kicked_off') return { state, word: KICKOFF.kickedOff };
	return { state: 'not_started', word: KICKOFF.next };
}

/** A scoreboard game's head at `now` by gameHead (home.ts bugHead's words): "Next kickoff" under a
 * game still to come with a kickoff to name, nothing with none. */
export function scoreboardCell(
	game: Pick<ScoreboardGame, 'state' | 'next_kickoff'>,
	now: number
): GameStateCell {
	const head = gameHead({ state: game.state, next: game.next_kickoff }, now);
	if (head.state === 'final') return { state: 'final', word: KICKOFF.final };
	if (head.state === 'kicked_off') return { state: 'kicked_off', word: KICKOFF.kickedOff };
	return { state: 'not_started', word: head.next === null ? '' : KICKOFF.next };
}
