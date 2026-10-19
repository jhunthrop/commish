/** One word, one meaning (the coordinator's ruling on the sweep's X1 and X2): the head each figure
 * carries on every screen, from this one module, so no screen heads one figure with another's word.
 * The words are figure-words.json's, the table the API's tests read too (its order basis names the
 * same heads). No imports, so the board's first state reads it at no cost.
 *
 *   projected  the projection's total for the season, the rest of it in season ("242.5")
 *   points     points scored to date
 *   perGame    the rest-of-season projection a game ("22.0"), never this season's average
 *   avg        this season's points a game to date ("30.7"), as the box score heads it */
export const FIGURE = {
	projected: 'Projected',
	points: 'Points',
	perGame: 'A game',
	avg: 'Avg'
} as const;
