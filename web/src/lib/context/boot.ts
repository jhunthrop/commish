/** What this browser keeps of the site's context for the session, and the boot script that marks the
 * page before its first paint, so the basis line a selected league adds has its room from the start
 * and nothing under it moves when the store fills it in. */
import { SESSION_CSRF_COOKIE } from '#lib/api/session.ts';

/** The session's copy of the context, in sessionStorage. */
export const CONTEXT_KEY = 'commish-context';

/** The root's attribute while a league is selected: how many lines its basis line takes on a phone,
 * "1" or "2". The line's room comes from it (ContextNote). */
export const LEAGUE_ATTR = 'data-league';

/** A basis line longer than this wraps to two lines on a phone. */
export const ONE_PHONE_LINE = 48;

/** Sets LEAGUE_ATTR from the session's copy, only for a browser holding a session. */
export const CONTEXT_BOOT_SCRIPT = `(function(){try{if(document.cookie.indexOf(${JSON.stringify(
	`${SESSION_CSRF_COOKIE}=`
)})<0)return;var k=JSON.parse(sessionStorage.getItem(${JSON.stringify(
	CONTEXT_KEY
)})||'null');if(k&&k.lines)document.documentElement.setAttribute(${JSON.stringify(
	LEAGUE_ATTR
)},String(k.lines));}catch(e){}})();`;
