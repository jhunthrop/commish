/** The week a rest of season counts from, said once on every screen built from the run (Lane 86, the
 * API's restFromWords and the nightly's rest_from_words). The run says each figure's week; this only
 * words it. */
import type { BoardRow, Format } from './schema.ts';

/** "from week 7", or while a game of that week is played "from week 6's games left". */
export function restFromWords(week: number, partial: boolean): string {
	return partial ? `from week ${String(week)}'s games left` : `from week ${String(week)}`;
}

/** A player's own week: "from week 7", or "with no game left" (his club's first game still to play is one
 * week, so his words never say a week is partly played). */
export function playerRestWords(week: number | null): string {
	return week === null ? 'with no game left' : restFromWords(week, false);
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
