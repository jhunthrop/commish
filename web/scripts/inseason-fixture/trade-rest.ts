// Lane 269's rest-of-season rule on the fixture's trades, as the API's finder and check apply it
// (inseason trades.go restOfSeason, Acceptable, GiveUp; words.go RestOfSeasonBasis), stamped when
// serve.ts loads the answer and restated at each clock over the weeks the order covers then:
// each side's rest of season is what the players it gets score over the waiver level, less the same
// for those it gives and drops, over the weeks; a side takes a trade that costs it GIVE_UP_PER_WEEK or
// less for each of those weeks; the finder lists only trades both sides take, and the check answers
// whether each side would.
// STAND-IN, named in the lane's report (Lane 277): the waiver level is replacement itself, so a
// player counts his points over replacement a week, none under it, times the weeks; the API's level
// is the best free agent at his position in the league's last read. Their drop is theirs to choose
// and the fixture names none, so it counts none. Only the rule is meant to hold.
import type {
	PlayerLine,
	TradeAdvice,
	TradeCheck,
	TradeRow
} from '../../src/lib/league/inseason/api.ts';
import { roundTenth } from './tenths.ts';
import { weekSpan, type Horizon } from './week.ts';

/** The most rest of season a side gives up for each week it covers (trades.go GiveUpPerWeek). */
export const GIVE_UP_PER_WEEK = 1;

/** A player's points over the waiver level a week: none at or under it, none without a figure. */
function overWaivers(line: PlayerLine): number {
	return Math.max(0, line.points_over_replacement ?? 0);
}

const over = (side: readonly PlayerLine[]): number =>
	side.reduce((sum, line) => sum + overWaivers(line), 0);

/** Each side's rest of season a week: the member's after his drop, theirs with none named. */
function restAWeek(row: Pick<TradeRow, 'give' | 'get' | 'drop'>): { mine: number; theirs: number } {
	const drop = row.drop ? overWaivers(row.drop) : 0;
	return { mine: over(row.get) - over(row.give) - drop, theirs: over(row.give) - over(row.get) };
}

/** Whether a side takes a change of `rest` over `weeks`, on the printed tenth (trades.go Acceptable). */
export function acceptable(rest: number, weeks: number): boolean {
	return roundTenth(rest) >= -GIVE_UP_PER_WEEK * Math.max(1, weeks);
}

/** A row with both sides' rest of season over `weeks`, one decimal. */
export function withRest<T extends Pick<TradeRow, 'give' | 'get' | 'drop'>>(
	row: T,
	weeks: number
): T & Pick<TradeRow, 'my_rest_of_season' | 'their_rest_of_season'> {
	const { mine, theirs } = restAWeek(row);
	return {
		...row,
		my_rest_of_season: roundTenth(mine * weeks),
		their_rest_of_season: roundTenth(theirs * weeks)
	};
}

/** Whether both sides take the row, judged a week (the same rule over any count of weeks). */
function bothTake(row: TradeRow): boolean {
	const { mine, theirs } = restAWeek(row);
	return acceptable(mine, 1) && acceptable(theirs, 1);
}

/** The finder's answer with only the trades both sides take (trades.go: a trade either side refuses is
 * dropped, never shown with a warning); a team with none keeps its roster and lists no trade. */
export function acceptedTrades(trades: TradeAdvice): TradeAdvice {
	return {
		...trades,
		teams: trades.teams.map((team) => ({ ...team, trades: team.trades.filter(bothTake) }))
	};
}

/** The rest-of-season line in the API's words (words.go RestOfSeasonBasis), the finder's or the
 * builder's rule, over the best free agent (the fixture reads the league's free agents). */
export function restBasis(weeks: number, h: Horizon, finder: boolean): string {
	const limit = (GIVE_UP_PER_WEEK * Math.max(1, weeks)).toFixed(1);
	const rule = finder
		? `We list a trade only when neither side falls by more than ${limit}.`
		: `A side takes a trade that costs it ${limit} or less.`;
	return `Rest of season is what the players a side gets score over the best free agent at their position, less the same for those it gives and drops, ${weekSpan(weeks, h)}. ${rule}`;
}

/** The finder's answer with every row's rest of season over `weeks` and its line. */
export function tradesWithRest(trades: TradeAdvice, weeks: number, h: Horizon): TradeAdvice {
	return {
		...trades,
		rest_of_season_basis: restBasis(weeks, h, true),
		teams: trades.teams.map((team) => ({
			...team,
			trades: team.trades.map((row) => withRest(row, weeks))
		}))
	};
}

/** A check with its trade's rest of season over `weeks`, whether each side takes it, and its line. */
export function checkWithRest(check: TradeCheck, weeks: number, h: Horizon): TradeCheck {
	const trade = withRest(check.trade, weeks);
	return {
		...check,
		trade,
		acceptable: {
			yours: acceptable(trade.my_rest_of_season ?? 0, weeks),
			theirs: acceptable(trade.their_rest_of_season ?? 0, weeks)
		},
		rest_of_season_basis: restBasis(weeks, h, false)
	};
}
