/** The current week's games on the schedule grid and a club's schedule (Lane 223, B187): each game's
 * state as the run read it (the nightly's snapshot, `RunGame.state`, Lane 80), in the words the
 * Rankings print (GAME_STATE_WORDS, kickoffAt), under one line naming the run's read, so a state is
 * never claimed live. Nothing here reads a clock: the state is the run's, the read its stamp. Pure,
 * tested in schedule-state.test.ts. */
import { kickoffAt } from '#lib/format/clock.ts';
import { dayTimeStamp } from '#lib/format/day-time.ts';
import { GAME_STATE_WORDS } from '#lib/format/game-facts.ts';
import type { Reach } from './reach.ts';
import type { Game } from './schema.ts';

/** A game of the current week as the run read it: its state and its kickoff. */
export interface RunStatedGame {
	state: NonNullable<Game['state']>;
	kickoff: string;
}

/** The week whose games the schedule says the state of, and when the run read them. */
export interface CurrentWeek {
	week: number;
	/** The run's instant (its manifest's runAt): the read every state is as of. */
	readAt: string;
}

/** Every word the current week's games print beyond the state words, for the copy guard. */
export const SCHEDULE_STATE_WORDS = {
	/** "Week 7's games as of Sun Oct 25, 12:51 am Central.": the run's read, said once. */
	asOf: (week: number, stamp: string): string => `Week ${String(week)}'s games as of ${stamp}.`
} as const;

/** The week being played at the run: the one after the last complete week, while the season is
 * underway, the run carries the games' states and the schedule holds that week; null otherwise. */
export function currentWeek(
	games: readonly Pick<Game, 'week' | 'state'>[],
	reach: Reach,
	underway: boolean,
	readAt: string
): CurrentWeek | null {
	if (!underway) return null;
	const week = reach.complete + 1;
	const held = games.filter((game) => game.week === week);
	if (held.length === 0 || held.some((game) => game.state === undefined)) return null;
	return { week, readAt };
}

/** A game's state as its cell carries it: the run's, on the current week alone. */
export function statedGame(
	game: Pick<Game, 'week' | 'state' | 'kickoff'>,
	current: CurrentWeek | null
): RunStatedGame | null {
	if (game.state === undefined || current?.week !== game.week) return null;
	return { state: game.state, kickoff: game.kickoff };
}

/** The game's word: Final, Kicked off, or its kickoff with its day and zone ("Sun 12:00 pm CT"). */
export function stateWord(game: RunStatedGame, zone: string): string {
	return game.state === 'upcoming' ? kickoffAt(game.kickoff, zone) : GAME_STATE_WORDS[game.state];
}

/** The line under the week's games naming the run's read. */
export function asOfLine(current: CurrentWeek, zone: string): string {
	return SCHEDULE_STATE_WORDS.asOf(current.week, dayTimeStamp(current.readAt, zone));
}
