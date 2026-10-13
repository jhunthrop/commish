/** Whether this browser holds a signed-in session, read from the CSRF cookie the API sets only with
 * one. Tiny on purpose: the head's boot script and the rail read it without the API client. */

/** The session's CSRF cookie. */
export const SESSION_CSRF_COOKIE = 'commish_csrf';

/** Set on <html> before first paint when the cookie is there, so the phone's bar can hold the slot
 * League may take until /me answers. */
export const SESSION_ATTR = 'data-session';

/** Whether this browser holds a signed-in session's CSRF cookie: a page can skip a call that would
 * answer 401 to a signed-out reader. */
export function hasSessionCookie(): boolean {
	return document.cookie.split('; ').some((entry) => entry.startsWith(`${SESSION_CSRF_COOKIE}=`));
}

/** Runs in the document head before first paint, beside the theme's boot script (hooks.server.ts). */
export const SESSION_BOOT_SCRIPT = `(function(){if(document.cookie.split('; ').some(function(c){return c.indexOf(${JSON.stringify(
	`${SESSION_CSRF_COOKIE}=`
)})===0}))document.documentElement.setAttribute(${JSON.stringify(SESSION_ATTR)},'')})();`;
