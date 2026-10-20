/** A count of players always names its pool (the ruling on the sweep's X4, M4), so no two screens give
 * two figures under one name: the players we rank (the run's pages, its manifest's count), the players
 * on rosters our order covers (the API's count), the players our board ranks (the run's board file, its
 * ranked rows: the front door), the same board with its kickers and defenses (the whole file: the sheet
 * starts from it), and the room's players not yet drafted (the API's room board). A filtered view
 * counts its matches, never the pool. Each count is a run or API figure, printed here. */
import { count, plural } from './number.ts';

export const POOL = {
	ranked: 'ranked',
	rosters: 'on NFL rosters',
	board: 'on our board',
	boardWithMarket: 'on our board with kickers and defenses',
	room: 'left to draft'
} as const;

export type Pool = keyof typeof POOL;

/** "619 ranked", "1,365 on NFL rosters", "619 on our board", "665 on our board with kickers and
 * defenses", "1,413 left to draft". */
export function poolCount(players: number, pool: Pool): string {
	return `${count(players)} ${POOL[pool]}`;
}

/** A board file's rows counted under the pool they make: its kickers and defenses (in draft order)
 * named when it carries them, so the sheet's count never reads against the front door's. */
export function boardPoolCount(rows: readonly { draftOrder?: boolean }[]): string {
	return poolCount(
		rows.length,
		rows.some((row) => row.draftOrder === true) ? 'boardWithMarket' : 'board'
	);
}

/** The order's hits: its pool with no filter set ("1,365 on NFL rosters"), the matches with a search, a
 * position or a roster filter ("12 matches"), which are no longer the pool. */
export function hitsWords(total: number, filtered: boolean): string {
	return filtered ? plural(total, 'match', 'matches') : poolCount(total, 'rosters');
}

/** The site search's placeholder: "Search 619 ranked players", the players it finds pages for. */
export function searchPlaceholder(ranked: number): string {
	return `Search ${poolCount(ranked, 'ranked')} players`;
}
