/** Signing in from a content page returns through the account page: it reads the account's league
 * there, keeps the line hint (boot.ts) for it, and then goes on to the page the reader left, so that
 * page's first paint already keeps the league line's room. The account page checks where it goes on
 * to with then-path.ts. */
import { links } from '#lib/site/links.ts';
import { THEN_PARAM } from './then-path.ts';

/** The return address a sign-in names for a reader on `path`: the account page, then `path`. */
export function signInReturn(path: string): string {
	return `${links.account()}?${new URLSearchParams({ [THEN_PARAM]: path }).toString()}`;
}
