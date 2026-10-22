/** A club's bye as a board row says it (Lane 140, C26): on a rest-of-season board a bye already past
 * reads "Done", since it costs him no game the board counts; a bye ahead prints its week. */
import { EMPTY_FIGURE } from './empty.ts';

export const BYE_WORDS = { done: 'Done' } as const;

/** The bye cell: its week, "Done" once it is before the week the board ranks from, the empty figure
 * when the run names none. `fromWeek` is null on a board of the full season, where every bye counts. */
export function byeCell(bye: number | null, fromWeek: number | null): string {
	if (bye === null) return EMPTY_FIGURE;
	return fromWeek !== null && bye < fromWeek ? BYE_WORDS.done : String(bye);
}
