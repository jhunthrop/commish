/** The board's own words (BoardView.svelte, the row's heads in board-columns.ts and Row.svelte), in one
 * table the apps print from too (shared/scripts/gen-words.ts, Lane 182). */
import type { Position } from '#lib/types/player.ts';

export const BOARD = {
	/** The position chip that shows every position. */
	all: 'All',
	/** The defense's position as the board names it, where the API names it DEF. */
	defense: 'DST' satisfies Position,
	/** The head over a position's players on a season-long list, after its available players. */
	heldHead: 'On a season-long list, his figures assume he plays',
	/** The Over replacement column's head where the column is narrow. */
	overReplShort: 'Over repl',
	gap: 'Gap',
	/** A kicker's or a defense's place among the players the drafts take. */
	draftOrder: 'Draft order',
	adp: 'ADP',
	/** A row's bye on the phone, "Bye 7". */
	bye: 'Bye'
} as const;

/** Each scoring format's chip, by the API's format id (GET /boards/{format}). */
export const BOARD_FORMAT_WORDS = {
	ppr: 'PPR',
	half: 'Half PPR',
	std: 'Standard'
} as const;
