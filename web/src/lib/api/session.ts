/** Whether this browser holds a signed-in session, read from the CSRF cookie the API sets only with
 * one. Tiny on purpose: the rail reads it without the API client. */

/** The session's CSRF cookie. */
export const SESSION_CSRF_COOKIE = 'commish_csrf';

/** Whether this browser holds a signed-in session's CSRF cookie: a page can skip a call that would
 * answer 401 to a signed-out reader. */
export function hasSessionCookie(): boolean {
	return document.cookie.split('; ').some((entry) => entry.startsWith(`${SESSION_CSRF_COOKIE}=`));
}
