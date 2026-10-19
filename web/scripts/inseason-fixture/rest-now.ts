/** The fixture API's rest of season at its clock (Lane 86), as the API's RestAt and LiveBoard
 * (api/internal/inseason/restlive.go) take it: the order's figures are from week 6 (order.ts), so a
 * player whose club's week 6 game is no longer upcoming at the clock, or whose club is on bye, counts
 * from week 7, his total his points a game times the games still to play; the order starts at the
 * earliest week with a game left and, while a game of it has kicked off, says it counts that week's
 * games still to play. The words are the API's (words.go restFromWords, OrderScreenBasis). */
import type { components } from '../../src/lib/api/types.ts';
import { stateAt } from './game-state.ts';
import { roundTenth } from './tenths.ts';

type OrderAdvice = components['schemas']['OrderAdvice'];
type OrderRow = components['schemas']['OrderRow'];
type PlayerLine = components['schemas']['PlayerLine'];

/** The week the fixture's order.json counts from. */
export const ORDER_FROM_WEEK = 6;
const NEXT_WEEK = ORDER_FROM_WEEK + 1;

/** Whether his club's week 6 game is played or kicked off at `now` (a bye is no game to play). */
function weekPlayed(line: PlayerLine, now: number): boolean {
	const facts = line.facts as unknown as { bye?: boolean; kickoff: string | null; played: boolean };
	if (facts.bye === true) return true;
	return stateAt({ ...facts, team: line.player.team }, now) !== 'upcoming';
}

/** His rest of season at `now` from his order row: the week it starts from and his total over the
 * games still to play, the order's from week 6 less a week 6 game kicked off since. */
export function restOfRow(
	row: Pick<OrderRow, 'line' | 'rest_of_season_points'>,
	now: number
): { points: number | null; fromWeek: number } {
	const played = weekPlayed(row.line, now);
	const perGame = row.line.rest_of_season_per_game;
	const points = row.rest_of_season_points;
	const fromWeek = played ? NEXT_WEEK : ORDER_FROM_WEEK;
	if (points === null || perGame === null || !played || row.line.facts.bye)
		return { points, fromWeek };
	return { points: roundTenth(points - perGame), fromWeek };
}

/** "from week 7", or "from week 6's games still to play" (words.go restFromWords). */
function restFromWords(week: number, partial: boolean): string {
	return partial ? `from week ${String(week)}'s games still to play` : `from week ${String(week)}`;
}

/** The order at `now`: each row's total over his club's games still to play, the order's first week
 * and its line said as the API says them. */
export function orderAtClock(order: OrderAdvice, now: number): OrderAdvice {
	const rows = order.rows.map((row) => ({
		...row,
		rest_of_season_points: restOfRow(row, now).points
	}));
	const played = order.rows.map((row) => weekPlayed(row.line, now));
	const fromWeek = played.every(Boolean) ? NEXT_WEEK : ORDER_FROM_WEEK;
	const partial = fromWeek === ORDER_FROM_WEEK && played.some(Boolean);
	const basis = order.basis.replace(
		/^Our rest-of-season order from week \d+\./,
		`Our rest-of-season order ${restFromWords(fromWeek, partial)}.`
	);
	return { ...order, basis, from_week: fromWeek, rows };
}

/** The player read's rest of season at `now` (rest_of_season_points, rest_from_week): his order
 * row's, nothing for a player the order does not hold. */
export function playerRest(
	rows: readonly OrderRow[],
	id: string,
	now: number
): { rest_of_season_points?: number; rest_from_week?: number } {
	const row = rows.find((r) => r.line.player.board_id === id);
	if (row === undefined) return {};
	const rest = restOfRow(row, now);
	return rest.points === null
		? {}
		: { rest_of_season_points: rest.points, rest_from_week: rest.fromWeek };
}
