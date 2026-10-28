/** The league rows' short status words (Lane 268): the trade rows' tight chip says a return day in a
 * few characters. League-scoped, so the words load with the league pages alone, never on every page
 * the way format/designation.ts does; the whole marks stay there (returningMark, seasonLongMark). */
import { calendarDay } from '#lib/format/designation.ts';

/** The return word of a tight row's chip: "Back Sun", "Back Nov 8". */
export const BACK_WORD = 'Back';

/** "Back Sun" for a player due back this week, "Back Nov 8" for a list's later return: the return day
 * in the few characters a tight row's chip has. */
export function returningShort(returning: string, thisWeek: boolean): string {
	const day = calendarDay(returning, thisWeek);
	return `${BACK_WORD} ${thisWeek ? day.slice(0, 3) : day}`;
}
