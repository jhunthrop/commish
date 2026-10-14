/** Where the account page may go on to after a sign-in: a path on this site and nothing else. Pure,
 * so the tests read the same rule the page runs. */

/** The account page's parameter naming where to go on after it. */
export const THEN_PARAM = 'then';

/** A `then` value resolved against this site's origin: its path, query and hash when it stays on
 * this origin, null otherwise. The URL parser decides, so "/\t/evil.example" (a tab the parser drops,
 * leaving "//evil.example"), "//evil.example" and "https://evil.example" all resolve to another
 * origin and are refused. */
export function safeThen(value: string | null, origin: string): string | null {
	if (value === null || value === '') return null;
	let url: URL;
	try {
		url = new URL(value, origin);
	} catch {
		return null;
	}
	if (url.origin !== new URL(origin).origin) return null;
	return `${url.pathname}${url.search}${url.hash}`;
}
