/** A club's mark, beside the headshot helper (headshot.ts): a defense's face, where a player's
 * headshot sits, served from our own origin at the size it is drawn (Lane 66w), as every headshot is:
 * the image route (/img/clubs/<league>/<club>/<width>) fetches the provider's mark at that width once
 * and keeps it at the edge. The one place the mark's address is built, in its own module so the
 * shell's chunk, which carries the headshot helper, does not carry it too. The route's own rules are
 * server/image-route.ts's. */

/** Where the image route lives. */
export const CLUB_MARK_ROUTE = '/img/clubs';
export const CLUB_MARK_LEAGUE = 'nfl';
/** The width a mark is fetched at: twice the 32 px circle a row draws it in, so it is sharp at 2x. */
export const CLUB_MARK_WIDTH = 64;
/** The widths the route serves: the ones a screen draws, so the edge holds a bounded set. */
export const CLUB_MARK_WIDTHS: readonly number[] = [CLUB_MARK_WIDTH];

/** A club's mark on our origin. */
export function clubMark(club: string): string {
	return `${CLUB_MARK_ROUTE}/${CLUB_MARK_LEAGUE}/${club.toLowerCase()}/${String(CLUB_MARK_WIDTH)}`;
}
