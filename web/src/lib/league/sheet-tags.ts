/** Your sheet's tags on a board player, as a league's pages mark his row: none before the sheet is
 * in (lazySheet, loaded by the page). Read inside a template, it follows the sheet as it lands. */
import { lazySheet } from '#lib/site/lazy-sheet.svelte.ts';

export function sheetTags(boardId: string | null): readonly string[] {
	if (boardId === null) return [];
	return lazySheet.parts?.store.sheet.rows.find((row) => row.id === boardId)?.tags ?? [];
}
