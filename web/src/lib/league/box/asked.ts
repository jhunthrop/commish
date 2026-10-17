/** The player a player page's verb sent here (?player=, Lane 66h): the league screens read him from
 * the address, and his row (a BoxLine names its board id) is marked and brought into view. */

/** The query field the player card's verb names him by. */
export const ASKED_PARAM = 'player';

/** The board id the address asks for, null with none. */
export function askedPlayer(href: string): string | null {
	return new URL(href).searchParams.get(ASKED_PARAM);
}

/** Marks his row under root and scrolls it to the middle; false when no row there is his. */
export function markAsked(root: Element | Document, boardId: string): boolean {
	const row = root.querySelector(`tr[data-player="${CSS.escape(boardId)}"]`);
	if (!(row instanceof HTMLElement)) return false;
	row.dataset.asked = '';
	row.scrollIntoView({ block: 'center' });
	return true;
}
