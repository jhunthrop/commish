/** A count of players always names its pool (the ruling on the sweep's X4), so two counts on one page
 * never read as two answers to one question: the players we rank (the run's pages, its manifest's
 * count), the players on rosters our order covers (the API's count), the players on our board a sheet
 * would start from (the run's board file, a build-time count). A filtered view counts its matches,
 * never the pool. Each count is a run or API figure, printed here. */
import { count, plural } from './number.ts';

export const POOL = {
	ranked: 'ranked',
	rosters: 'on rosters',
	board: 'on our board'
} as const;

export type Pool = keyof typeof POOL;

/** "619 ranked", "1,365 on rosters", "665 on our board". */
export function poolCount(players: number, pool: Pool): string {
	return `${count(players)} ${POOL[pool]}`;
}

/** The order's hits: its pool with no filter set ("1,365 on rosters"), the matches with a search, a
 * position or a roster filter ("12 matches"), which are no longer the pool. */
export function hitsWords(total: number, filtered: boolean): string {
	return filtered ? plural(total, 'match', 'matches') : poolCount(total, 'rosters');
}

/** The site search's placeholder: "Search 619 ranked players", the players it finds pages for. */
export function searchPlaceholder(ranked: number): string {
	return `Search ${poolCount(ranked, 'ranked')} players`;
}
