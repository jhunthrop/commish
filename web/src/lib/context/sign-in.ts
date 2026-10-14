/** Signing in from a content page returns through the account page: it reads the account's league
 * there, keeps the line hint (boot.ts) for it, and then goes on to the page the reader left, so that
 * page's first paint already keeps the league line's room. */
import { links } from '#lib/site/links.ts';

/** The account page's parameter naming where to go on after it. */
export const THEN_PARAM = 'then';

/** The return address a sign-in names for a reader on `path`: the account page, then `path`. */
export function signInReturn(path: string): string {
	return `${links.account()}?${new URLSearchParams({ [THEN_PARAM]: path }).toString()}`;
}

/** A `then` value the account page may go on to: a path on this site, never another origin. */
export function safeThen(value: string | null): string | null {
	if (value === null || !value.startsWith('/') || value.startsWith('//') || value.includes('\\'))
		return null;
	return value;
}
