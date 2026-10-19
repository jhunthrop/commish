/** The in-season words of a board and a player page, built when the page is: no script carries them. */
import { monthDayLabel } from '#lib/format/date.ts';
import { FIGURE } from '#lib/format/figure-words.ts';
import type { Format } from './schema.ts';

/** How far this season's figures reach, and the scoring they are in. */
export interface FiguresReach {
	/** That format as a chip prints it: "PPR". */
	scoring: string;
	/** The week the newest counted game belongs to, 0 before week 1's (run/season.ts
	 * newestCountedWeek): a Thursday player's GP is never past it. */
	through: number;
}

/** "Games and Avg are this season's, through week 5.", with ", scored in PPR" before the
 * week on a board of another scoring. */
export function figuresLine(format: Format, reach: FiguresReach): string {
	const scoring = reach.scoring === format.label ? '' : `, scored in ${reach.scoring}`;
	const through = reach.through === 0 ? '' : `, through week ${String(reach.through)}`;
	return `Games and ${FIGURE.avg} are this season's${scoring}${through}.`;
}

/** Once the run ranks the rest of the season: "Ranked by points over replacement for the rest of the
 * 2026 season from week 6, refreshed October 14. Games and points a game are this season's, through
 * week 5." The board gives no range in season, and the line names none. Null on a preseason board. */
export function restLead(format: Format, reach: FiguresReach, season: number): string | null {
	if (format.rosFromWeek === undefined || format.refreshedAt === undefined) return null;
	const rest = `the rest of the ${String(season)} season from week ${String(format.rosFromWeek)}`;
	return `Ranked by points over replacement for ${rest}, refreshed ${monthDayLabel(format.refreshedAt)}. ${figuresLine(format, reach)}`;
}

/** A rest-of-season figure's caption where no basis line sits beside it (/compare): "PPR points for
 * the rest of the 2026 season from week 7, refreshed October 21". Null on a preseason board. */
export function restCaption(format: Format, season: number): string | null {
	if (format.rosFromWeek === undefined || format.refreshedAt === undefined) return null;
	return `${format.label} points for the rest of the ${String(season)} season from week ${String(format.rosFromWeek)}, refreshed ${monthDayLabel(format.refreshedAt)}`;
}
