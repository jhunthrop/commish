/** What this browser keeps of the site's context, and the boot script that marks the page before
 * its first paint, so the basis line a selected league adds has its room from the start and nothing
 * under it moves when the store fills it in. Everything an account's leagues say is tied to the
 * session that wrote it and cleared at sign-out: another account on this browser never reads it. */
import { SESSION_CSRF_COOKIE } from '#lib/api/session.ts';

/** The copy of the context, in sessionStorage: the leagues and the selection with the session and
 * account it belongs to, or signed out a format this browser chose. */
export const CONTEXT_KEY = 'commish-context';

/** How many lines the selected league's basis line takes on a phone, in localStorage so a new
 * session's first page keeps its room too. A number, never the league, read by the boot only with
 * a session, and cleared at sign-out. */
export const LINES_KEY = 'commish-league-lines';

/** The root's attribute while a league is selected: the basis line's lines on a phone, "1" to "3".
 * The line's room comes from it (ContextNote). */
export const LEAGUE_ATTR = 'data-league';

/** Sets LEAGUE_ATTR from the kept lines, only for a browser holding a session. */
export const CONTEXT_BOOT_SCRIPT = `(function(){try{if(document.cookie.indexOf(${JSON.stringify(
	`${SESSION_CSRF_COOKIE}=`
)})<0)return;var n=localStorage.getItem(${JSON.stringify(
	LINES_KEY
)});if(n==='1'||n==='2'||n==='3')document.documentElement.setAttribute(${JSON.stringify(
	LEAGUE_ATTR
)},n);}catch(e){}})();`;
