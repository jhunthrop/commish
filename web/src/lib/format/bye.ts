/** A club's bye as a board row says it (Lane 140, C26): on a rest-of-season board a bye already past
 * reads "Done", since it costs him no game the board counts; a bye ahead prints its week. */
import { EMPTY_FIGURE } from './empty.ts';

export const BYE_WORDS = {
	done: 'Done',
	/** A phone row's bye beside his club, where the Bye column gives way (Lane 209): "Bye week 11". */
	week: (week: number) => `Bye week ${String(week)}`
} as const;

/** The bye cell: its week, "Done" once it is before the week the board ranks from, the empty figure
 * when the run names none. `fromWeek` is null on a board of the full season, where every bye counts. */
export function byeCell(bye: number | null, fromWeek: number | null): string {
	if (bye === null) return EMPTY_FIGURE;
	return fromWeek !== null && bye < fromWeek ? BYE_WORDS.done : String(bye);
}

/** A phone row's bye beside his club (Lane 209, Lane 208's F4): "Bye week 11" while it is ahead, and
 * nothing once it is played, as it costs him no game the board counts ("Bye done" beside a player
 * whose club plays today read as an error), nor when the run names none. */
export function byeLine(bye: number | null, fromWeek: number | null): string | null {
	if (bye === null || (fromWeek !== null && bye < fromWeek)) return null;
	return BYE_WORDS.week(bye);
}
