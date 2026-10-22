/** The week a rest of season counts from, said once on every screen built from the run (Lane 86, the
 * API's restFromWords and the nightly's rest_from_words). The run says each figure's week; this only
 * words it. */
import { FIGURE } from '#lib/format/figure-words.ts';
import type { BoardRow, Format } from './schema.ts';

/** The placeholder the words table's week templates carry. */
const WEEK_SLOT = '{week}';

/** The last week the run's rest-of-season points count (the API's LastWeek, the research
 * LAST_FANTASY_WEEK), or the board's own first week once the season is past it. */
export const RUN_LAST_WEEK = 17;

/** The weeks a player's rest of season counts, "weeks 7 to 17" (Lane 139, C03): his figure a game is
 * over his club's games in them, so the tile names the weeks his Still to play list holds through the
 * run's last week; "week 18" once the board's first week is its last, "with no game left" for none. */
export function restSpanWords(week: number | null): string {
	if (week === null) return playerRestWords(null);
	const last = Math.max(RUN_LAST_WEEK, week);
	return week === last ? `week ${String(week)}` : `weeks ${String(week)} to ${String(last)}`;
}

/** "from week 7", or while a game of that week is played "from week 6's games left". */
export function restFromWords(week: number, partial: boolean): string {
	return (partial ? FIGURE.restFromPartial : FIGURE.restFrom).replaceAll(WEEK_SLOT, String(week));
}

/** A player's own week: "from week 7", or "with no game left" (his club's first game still to play is one
 * week, so his words never say a week is partly played). */
export function playerRestWords(week: number | null): string {
	return week === null ? 'with no game left' : restFromWords(week, false);
}

/** The every-format table's points head: "Rest of season from week 7". */
export function restOfSeasonHead(from: string): string {
	return `Rest of season ${from}`;
}

/** The tier box's basis in season: "Projected PPR points for the rest of 2026 from week 8". */
export function tierBasisWords(label: string, season: number, from: string): string {
	return `Projected ${label} points for the rest of ${String(season)} ${from}`;
}

/** The board's words: its first week, and whether a game of it was played at the run. Null on a
 * preseason board. */
export function boardRestFrom(
	format: Partial<Pick<Format, 'rosFromWeek' | 'rosFromWeekPartial'>>
): string | null {
	if (format.rosFromWeek === undefined) return null;
	return restFromWords(format.rosFromWeek, format.rosFromWeekPartial === true);
}

/** The week a player's rest of season starts from: his club's first game still to play at the run,
 * the board's first week on a run older than the field, null with no game left or on a preseason
 * board. */
export function playerRestFrom(
	format: Partial<Pick<Format, 'rosFromWeek' | 'rosFromWeekPartial'>>,
	numbers: Partial<Pick<BoardRow, 'restFromWeek'>>
): number | null {
	if (format.rosFromWeek === undefined) return null;
	return numbers.restFromWeek === undefined ? format.rosFromWeek : numbers.restFromWeek;
}
