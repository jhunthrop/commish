/** Where the account page may go on to after a sign-in: a path on this site and nothing else; and
 * where a sign-in to follow a league goes on to. Pure, so the tests read the same rule the page runs. */
import { LEAGUE_START } from '#lib/ui/nav.ts';

/** The account page's parameter naming where to go on after it. */
export const THEN_PARAM = 'then';

/** A `then` value resolved against this site's origin: its path, query and hash when it stays on
 * this origin and its path starts with a single "/", null otherwise. The URL parser decides the
 * origin, so "/\t/evil.example" (a tab the parser drops, leaving "//evil.example"), "//evil.example"
 * and "https://evil.example" resolve to another origin and are refused; "/.//evil.example" keeps the
 * origin but collapses to "//evil.example", which the path check refuses. */
export function safeThen(value: string | null, origin: string): string | null {
	if (value === null || value === '') return null;
	let url: URL;
	try {
		url = new URL(value, origin);
	} catch {
		return null;
	}
	if (url.origin !== new URL(origin).origin) return null;
	const path = `${url.pathname || '/'}${url.search}${url.hash}`;
	// Dot segments collapse after the origin check ("/.//evil.example" has the pathname
	// "//evil.example"), and a navigation reads a leading "//" or "/\\" as another host: the path must
	// start with one "/" and no second slash of either kind.
	return /^\/(?![/\\])/.test(path) ? path : null;
}

/** The first path segment of every league page: the follow page and each league's screens. */
const LEAGUE_SEGMENT = '/league/';

/** Where a sign-in to follow a league goes on to from the page at `path` (its path and query): that
 * page when it is the follow page (keeping the screen a rail item named) or a league's own, else the
 * follow page. */
export function followThen(path: string): string {
	return path.startsWith(LEAGUE_SEGMENT) ? path : LEAGUE_START;
}
