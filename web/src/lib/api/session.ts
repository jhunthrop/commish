/** Whether this browser holds a signed-in session, read from the CSRF cookie the API sets only with
 * one. Tiny on purpose: the rail reads it without the API client. */

/** The session's CSRF cookie. */
export const SESSION_CSRF_COOKIE = 'commish_csrf';

/** Whether this browser holds a signed-in session's CSRF cookie: a page can skip a call that would
 * answer 401 to a signed-out reader. */
export function hasSessionCookie(): boolean {
	return sessionToken() !== null;
}

/** This browser's session, named by its CSRF cookie's value (never the session itself), or null
 * signed out: what a copy kept in the browser is tied to, so another session never reads it. */
export function sessionToken(): string | null {
	const pair = document.cookie
		.split('; ')
		.find((entry) => entry.startsWith(`${SESSION_CSRF_COOKIE}=`));
	return pair ? pair.slice(SESSION_CSRF_COOKIE.length + 1) : null;
}
