/** A count of players always names its pool (the ruling on the sweep's X4), so two counts on one page
 * never read as two answers to one question: the players we rank (the run's pages, its manifest's
 * count), the players on rosters our order covers (the API's count), the players a sheet started
 * from our board holds (the board the sheet reads). Each count is a run or API figure, printed here. */
import { count } from './number.ts';

export const POOL = {
	ranked: 'ranked',
	rosters: 'on rosters',
	sheet: 'on the sheet'
} as const;

export type Pool = keyof typeof POOL;

/** "619 ranked", "1,365 on rosters", "665 on the sheet". */
export function poolCount(players: number, pool: Pool): string {
	return `${count(players)} ${POOL[pool]}`;
}

/** The site search's placeholder: "Search 619 ranked players", the players it finds pages for. */
export function searchPlaceholder(ranked: number): string {
	return `Search ${poolCount(ranked, 'ranked')} players`;
}
