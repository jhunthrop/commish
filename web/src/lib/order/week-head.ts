/** The kickers' and defenses' tab's head (Lane 66w), in a file of its own: the board's page reads it
 * over the board's words (site/season-words.ts), which the shell carries, so the shell does not carry
 * these. */
import type { BoardWords } from '#lib/site/season-words.ts';
import { railInSeason, type RailKey } from '#lib/ui/nav.ts';

/** The API's position for the week's tab. */
export type WeekPosition = 'K' | 'DEF';

/** The board's tab for the week's position: kickers on K, defenses on DST; null for any other. */
export function weekPositionOf(boardPosition: string | null): WeekPosition | null {
	if (boardPosition === 'K') return 'K';
	if (boardPosition === 'DST') return 'DEF';
	return null;
}

/** Each position's rows in the plural, as the tab's head names them. */
export const WEEK_MANY: Readonly<Record<WeekPosition, string>> = { K: 'kickers', DEF: 'defenses' };

/** The words beside a position in the bar and the document's title: "K this week". */
export const THIS_WEEK = 'this week';

/** Which tab a week read belongs to: the position it was asked for and the league it was read in
 * (Lane 66w rereview N1). The page keys the tab it shows and the read it holds the same way, so a read
 * that lands after its tab was left is never shown under another. */
export function weekReadKey(position: WeekPosition | null, league: string | null): string {
	return `${position ?? ''} ${league ?? ''}`;
}

/** The tab's head: "Week 6 kickers" once the week is read, "This week's kickers" before. */
export function weekHeading(position: WeekPosition, week: number | null): string {
	const many = WEEK_MANY[position];
	return week === null ? `This week's ${many}` : `Week ${String(week)} ${many}`;
}

/** The board's words on the kickers' and defenses' tabs in season: this week's, never the rest of the
 * season, since we rank neither for it. Any other tab, or a rail out of season, keeps the board's own. */
export function weekBoardWords(
	words: BoardWords,
	rail: RailKey,
	board: { label: string; position: string | null }
): BoardWords {
	const week = railInSeason(rail) ? weekPositionOf(board.position) : null;
	if (week === null || board.position === null) return words;
	return {
		...words,
		bar: `${board.position} ${THIS_WEEK}`,
		title: `${board.position} ${board.label} ${THIS_WEEK}`,
		heading: weekHeading(week, null)
	};
}
