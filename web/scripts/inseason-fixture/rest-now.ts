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

/** "from week 7", or "from week 6's games left" (words.go restFromWords). */
function restFromWords(week: number, partial: boolean): string {
	return partial ? `from week ${String(week)}'s games left` : `from week ${String(week)}`;
}

/** The order at `now`: each row's total over his club's games left, the order's first week
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

/** One club's games in the run's schedule.json. */
export interface RunSlate {
	abbr: string;
	games: { week: number; opponent: string | null; kickoff: string | null }[];
}

/** The run's in-season row for a player: his points and his club. */
export interface RunRow {
	team: string;
	projected: number;
}

const LAST_WEEK = 17;

/** A club's weeks from `from` through week 17 whose game is upcoming at `at` by the API's rule. */
function weeksToPlay(slate: RunSlate, from: number, at: number): number[] {
	return slate.games
		.filter(
			(g) =>
				g.week >= from &&
				g.week <= LAST_WEEK &&
				g.kickoff !== null &&
				stateAt(
					{ played: false, kickoff: g.kickoff, team: slate.abbr, opponent: g.opponent },
					at
				) === 'upcoming'
		)
		.map((g) => g.week);
}

/** The player read's rest of season from the run the site was built from, as the API's RestAt and
 * LiveBoard take it: the run's points a game (over his club's games still to play at the run) times
 * his club's games still to play at `now`, and his club's first of them. */
export function runRest(
	row: RunRow,
	run: { fromWeek: number; at: number; slates: readonly RunSlate[] },
	now: number
): { rest_of_season_points?: number; rest_from_week?: number } {
	const slate = run.slates.find((s) => s.abbr === row.team);
	if (slate === undefined) return {};
	const atRun = weeksToPlay(slate, run.fromWeek, run.at).length;
	const left = weeksToPlay(slate, run.fromWeek, now);
	if (atRun === 0) return {};
	const points = roundTenth((row.projected * left.length) / atRun);
	return left[0] === undefined
		? { rest_of_season_points: points }
		: { rest_of_season_points: points, rest_from_week: left[0] };
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
