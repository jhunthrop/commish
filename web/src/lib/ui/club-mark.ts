/** A club's mark, beside the headshot helper (headshot.ts): a defense's face, where a player's
 * headshot sits, served from our own origin at the size it is drawn (Lane 66w), as every headshot is:
 * the image route (/img/clubs/<league>/<club>/<width>) fetches the provider's mark at that width once
 * and keeps it at the edge. The one place the mark's address is built, in its own module so the
 * shell's chunk, which carries the headshot helper, does not carry it too. */

/** Where the image route lives. */
export const CLUB_MARK_ROUTE = '/img/clubs';
const CLUB_MARK_LEAGUE = 'nfl';
/** The width a mark is fetched at: twice the 32 px circle a row draws it in, so it is sharp at 2x. */
export const CLUB_MARK_WIDTH = 64;
/** The widths the route serves, so the cache holds a bounded set of sizes. */
export const CLUB_MARK_MIN_WIDTH = 16;
export const CLUB_MARK_MAX_WIDTH = 256;

const CLUB_CODE = /^[a-z]{2,3}$/;
const PATH = new RegExp(`^${CLUB_MARK_ROUTE}/([a-z]+)/([^/]+)/(\\d+)$`);

/** A club's code as the route takes it: two or three letters, lower case. */
export function isClubCode(value: string): boolean {
	return CLUB_CODE.test(value);
}

/** A club's mark at a width, on our origin. */
export function clubMark(club: string, width: number = CLUB_MARK_WIDTH): string {
	return `${CLUB_MARK_ROUTE}/${CLUB_MARK_LEAGUE}/${club.toLowerCase()}/${String(width)}`;
}

/** The route's path read back, null for one it does not serve. */
export function clubMarkPath(
	path: string
): { league: typeof CLUB_MARK_LEAGUE; club: string; width: number } | null {
	const match = PATH.exec(path);
	const [, league = '', club = '', widthText = ''] = match ?? [];
	const width = Number(widthText);
	if (
		league !== CLUB_MARK_LEAGUE ||
		!isClubCode(club) ||
		width < CLUB_MARK_MIN_WIDTH ||
		width > CLUB_MARK_MAX_WIDTH
	) {
		return null;
	}
	return { league, club, width };
}
