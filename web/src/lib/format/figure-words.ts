/** One word, one meaning (the coordinator's ruling on the sweep's X1 and X2): the head each figure
 * carries on every screen, from this one module, so no screen heads one figure with another's word.
 * The words are the one table, api/internal/figurewords/words.json, which the API embeds for its
 * sentences too; the build inlines it, so no copy is held here.
 *
 *   projected  the projection's total for the season, the rest of it in season ("242.5")
 *   points     points scored to date
 *   perGame    the rest-of-season projection a game ("22.0"), never this season's average
 *   avg        this season's points a game to date ("30.7"), as the box score heads it
 *   week       this week's projection where the season's Projected sits beside it (the order, the
 *              player card): "Wk 6", the API's week; a one-week box score keeps its own "Proj" */
import TABLE from '../../../../api/internal/figurewords/words.json' with { type: 'json' };

/** Each figure's head. */
export interface FigureWords {
	projected: string;
	points: string;
	perGame: string;
	avg: string;
	week: string;
	/** "from week {week}": the week a rest of season starts from (run/rest-from.ts). */
	restFrom: string;
	/** "from week {week}'s games left": the same while a game of that week has kicked off. */
	restFromPartial: string;
	/** "FA": the club cell of a free agent, no club (Lane 123, B101), as the API and the run carry it
	 * (clubs.ts isFreeAgent). */
	freeAgentClub: string;
	/** "a free agent": the same in a sentence. */
	freeAgent: string;
}

export const FIGURE: Readonly<FigureWords> = TABLE;

/** "Wk 6": this week's projection's head beside the season's, the week the API's answer is for,
 * never the reader's clock. */
export function weekHead(week: number): string {
	return `${FIGURE.week} ${String(week)}`;
}
