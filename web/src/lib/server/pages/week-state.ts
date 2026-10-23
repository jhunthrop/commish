/** A set week's game state on the record page (Lane 165, D08): the schedule's, by the one rule every
 * screen reads (linesRead over lineState, the API's state and the page's clock). A week is upcoming
 * before its first kickoff, under way from the first kickoff to the last final, played after. Pure,
 * so the record page and the front door's card say it the same way. */
import { linesRead } from '#lib/league/box/kickoff.ts';
import type { RunRecord, Schedule } from '#lib/run/schema.ts';

export interface WeekStates {
	/** Set weeks whose first kickoff is still ahead at the page's clock. */
	unplayed: number[];
	/** Set weeks with a kickoff behind them and a game not final yet. */
	underway: number[];
}

type ScheduledGame = Schedule['slates'][number]['games'][number];

/** A game the run has not marked final is final once this long has passed since its kickoff (Lane 165
 * fix round 1, M4): a build days after the run never reads a week "under way" past its last game's
 * end. A game runs about three hours; the hourly capture marks Final in the hour after. */
export const GAME_ENDS_AFTER_MS = 4 * 60 * 60 * 1000;

/** The run's state for a game, final when it has ended by the clock. */
function stateAt(game: ScheduledGame, now: number): ScheduledGame['state'] {
	return game.state !== 'final' && now >= Date.parse(game.kickoff) + GAME_ENDS_AFTER_MS
		? 'final'
		: game.state;
}

/** One week's games as one read, final once every one is; null for a week with no game on the schedule,
 * which is neither not played nor under way (M1). */
function weekRead(
	games: readonly ScheduledGame[],
	now: number
): 'upcoming' | 'playing' | 'final' | null {
	if (games.length === 0) return null;
	return linesRead(
		games.map((game) => ({
			game_state: stateAt(game, now) ?? null,
			played: false,
			kickoff: game.kickoff,
			bye: false
		})),
		now
	).state;
}

export function weekStates(loaded: RunRecord, schedule: Schedule, now: number): WeekStates {
	const games = schedule.slates.flatMap((slate) => slate.games);
	const frozen = loaded.weeks.filter((week) => week.status === 'frozen');
	const read = (week: number): ReturnType<typeof weekRead> =>
		weekRead(
			games.filter((game) => game.week === week),
			now
		);
	return {
		unplayed: frozen.filter((week) => read(week.week) === 'upcoming').map((week) => week.week),
		underway: frozen.filter((week) => read(week.week) === 'playing').map((week) => week.week)
	};
}
