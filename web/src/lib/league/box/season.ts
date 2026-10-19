/** The in-season screens' words for the rest of the season (Lane 66u, 66t, sweep X6), one module
 * Trades and Waivers both read so one head never means two figures: "A game" heads his rest-of-season
 * points a game wherever it heads a column, as on the order, and a gain is headed "Gain" with its
 * basis beside it. The API's basis says what each is, once (inseason words.go, pergame.go). */
import { FIGURE } from '#lib/format/figure-words.ts';

export const SEASON = {
	/** His rest-of-season points a game, the only figure this head names (the figure words' perGame). */
	perGame: FIGURE.perGame,
	/** A lineup's change in points over replacement a week. */
	gain: 'Gain'
} as const;

/** Trades' head over each side's gain: over replacement a week, shortened as the order's Over repl. head
 * is so the group's head keeps to one line at a desk. */
export const TRADE_GAIN = `${SEASON.gain}, over repl. a week`;

/** The Waivers card's and drop panel's gain: a week. */
export const WAIVER_GAIN = `${SEASON.gain} a week`;
