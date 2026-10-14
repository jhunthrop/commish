/** What this browser keeps of the site's context, and the boot script that marks the page before
 * its first paint, so the basis line a selected league adds has its room from the start and nothing
 * under it moves when the store fills it in. */
import { SESSION_CSRF_COOKIE } from '#lib/api/session.ts';

/** The session's copy of the context, in sessionStorage: the leagues, the selection, the rosters. */
export const CONTEXT_KEY = 'commish-context';

/** How many lines the selected league's basis line takes on a phone, in localStorage so a new
 * session's first page keeps its room too. A number, never the league: another account on this
 * browser learns nothing from it, and the boot reads it only with a session. */
export const LINES_KEY = 'commish-league-lines';

/** The root's attribute while a league is selected: the basis line's lines on a phone, "1" or "2".
 * The line's room comes from it (ContextNote). */
export const LEAGUE_ATTR = 'data-league';

/** A basis line longer than this wraps to two lines on a phone. */
export const ONE_PHONE_LINE = 48;

/** Sets LEAGUE_ATTR from the kept lines, only for a browser holding a session. */
export const CONTEXT_BOOT_SCRIPT = `(function(){try{if(document.cookie.indexOf(${JSON.stringify(
	`${SESSION_CSRF_COOKIE}=`
)})<0)return;var n=localStorage.getItem(${JSON.stringify(
	LINES_KEY
)});if(n==='1'||n==='2')document.documentElement.setAttribute(${JSON.stringify(
	LEAGUE_ATTR
)},n);}catch(e){}})();`;
