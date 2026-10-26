/** A club's bye as a row says it: a bye ahead prints its week, and a bye already played draws nothing
 * (Lane 223, B190, after Lane 140's "Done", which read beside a club playing today as an error), since
 * it costs him no game a rest-of-season board counts. */
import { EMPTY_FIGURE } from './empty.ts';

export const BYE_WORDS = {
	/** A phone row's bye beside his club, where the Bye column gives way (Lane 209): "Bye week 11". */
	week: (week: number) => `Bye week ${String(week)}`,
	/** A club's bye where the run names none, in the same form (Lane 223 review L3). */
	notSet: 'Bye week not set'
} as const;

/** The bye still ahead of the week the board ranks from, null once played or when the run names none.
 * `fromWeek` is null on a board of the full season, where every bye counts. */
export function byeAhead(bye: number | null, fromWeek: number | null): number | null {
	return bye === null || (fromWeek !== null && bye < fromWeek) ? null : bye;
}

/** The narrow Bye column's cell: its week while ahead, nothing once played, the empty figure when the
 * run names none. */
export function byeCell(bye: number | null, fromWeek: number | null): string {
	if (bye === null) return EMPTY_FIGURE;
	const ahead = byeAhead(bye, fromWeek);
	return ahead === null ? '' : String(ahead);
}

/** A phone row's bye beside his club (Lane 209, Lane 208's F4): "Bye week 11" while it is ahead, and
 * nothing once it is played, as it costs him no game the board counts ("Bye done" beside a player
 * whose club plays today read as an error), nor when the run names none. */
export function byeLine(bye: number | null, fromWeek: number | null): string | null {
	const ahead = byeAhead(bye, fromWeek);
	return ahead === null ? null : BYE_WORDS.week(ahead);
}
