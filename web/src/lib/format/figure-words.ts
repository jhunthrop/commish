/** One word, one meaning (the coordinator's ruling on the sweep's X1 and X2): the head each figure
 * carries on every screen, from this one module, so no screen heads one figure with another's word.
 * The words are figure-words.json's, the table the API's tests read too (its order basis names the
 * same heads). No imports, so the board's first state reads it at no cost.
 *
 *   projected  the projection's total for the season, the rest of it in season ("242.5")
 *   points     points scored to date
 *   perGame    the rest-of-season projection a game ("22.0"), never this season's average
 *   avg        this season's points a game to date ("30.7"), as the box score heads it
 *   week       this week's projection where the season's Projected sits beside it (the order):
 *              "Wk 6", the API's week; a one-week box score keeps its own "Proj" */
export const FIGURE = {
	projected: 'Projected',
	points: 'Points',
	perGame: 'A game',
	avg: 'Avg',
	week: 'Wk'
} as const;

/** "Wk 6": this week's projection's head beside the season's, the week the API's answer is for,
 * never the reader's clock. */
export function weekHead(week: number): string {
	return `${FIGURE.week} ${String(week)}`;
}
