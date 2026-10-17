/** The player a player page's verb sent here (?player=, Lane 66h): the league screens read him from
 * the address, and his row (a BoxLine names its board id) is marked and brought into view. */

/** What Waivers says when the asked player is not among its adds (rereview N6). */
export const NOT_FREE = 'He is not a free agent in this league.';

/** The query field the player card's verb names him by. */
export const ASKED_PARAM = 'player';

/** The query field naming his position, which Waivers narrows to when its first answer does not hold
 * him. */
export const POSITION_PARAM = 'position';

/** A league screen the player's verbs open. */
export type AskedScreen = 'start' | 'waivers' | 'trades';

/** The query a league screen's link names him by, one builder for the player card and the order
 * (review 66j N2): ?player= always, and his position for Waivers. */
export function askedQuery(
	screen: AskedScreen,
	who: { id: string; position: string }
): Record<string, string> {
	return screen === 'waivers'
		? { [ASKED_PARAM]: who.id, [POSITION_PARAM]: who.position }
		: { [ASKED_PARAM]: who.id };
}

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
