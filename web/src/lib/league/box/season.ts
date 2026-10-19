/** The in-season screens' words for the rest of the season (Lane 66u, sweep X6), one module Trades
 * and Waivers both read so one head never means two figures: "Rest of season" heads his points a
 * game on our rest-of-season projection wherever it heads a column, and a gain is headed "Gain" with
 * its basis beside it. The API's basis says what each is, once (inseason words.go). */
export const SEASON = {
	/** His points a game on our rest-of-season projection, the only figure this head names. */
	restOfSeason: 'Rest of season',
	/** A lineup's change in points over replacement a week. */
	gain: 'Gain'
} as const;

/** Trades' head over each side's gain: over replacement a week. */
export const TRADE_GAIN = `${SEASON.gain}, over replacement a week`;

/** The Waivers card's and drop panel's gain: a week. */
export const WAIVER_GAIN = `${SEASON.gain} a week`;
