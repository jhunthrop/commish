/**
 * A finished mock as a sheet, the report's "Save this draft as a sheet": your picks first in the
 * order you made them, then the rest of that room's board in its order, so the next room starts
 * from what you just did. The room hands over its own players, so the faces and teams are the ones
 * that draft showed.
 */
import { SHEET_LIMITS } from './limits.ts';
import { rowFor, type SheetPlayer, type SheetRow } from './model.ts';

export interface FinishedDraft {
	/** Your picks, first pick first. */
	yourPicks: readonly SheetPlayer[];
	/** The room's board, best first. Your picks may be on it. */
	board: readonly SheetPlayer[];
}

export function rowsFromDraft(draft: FinishedDraft): readonly SheetRow[] {
	const taken = new Set(draft.yourPicks.map((player) => player.id));
	const rest = draft.board.filter((player) => !taken.has(player.id));
	return [...draft.yourPicks, ...rest].slice(0, SHEET_LIMITS.rows).map(rowFor);
}
