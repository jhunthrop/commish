/** What this browser keeps of the site's context, and the boot script that marks the page before
 * its first paint: the room the basis line a selected league adds takes, so nothing under it moves
 * when the store fills it in, and the rail the season's phase shows (spec 2026-10-16 §2), so the
 * rail is right on the first frame. Everything an account's leagues say is tied to the session that
 * wrote it and cleared at sign-out: another account on this browser never reads it. */
import { SESSION_CSRF_COOKIE } from '#lib/api/session.ts';
import { RAIL_KEYS, type RailKey } from '#lib/ui/nav.ts';

/** The copy of the context, in sessionStorage: the leagues, the selection and the rail with the
 * session and account it belongs to, or signed out a format this browser chose. */
export const CONTEXT_KEY = 'commish-context';

/** How many lines the selected league's basis line takes on a phone, in localStorage so a new
 * session's first page keeps its room too. A number, never the league, read by the boot only with
 * a session, and cleared at sign-out. */
export const LINES_KEY = 'commish-league-lines';

/** The root's attribute while a league is selected: the basis line's lines on a phone, "1" to "3".
 * The line's room comes from it (ContextNote). */
export const LEAGUE_ATTR = 'data-league';

/** The rail the account's context shows, in localStorage so a new tab or a restarted browser
 * paints it before /me answers: a phase word (nav.ts RAIL_KEYS), never the league. Read by the boot
 * only with a session, and cleared at sign-out. */
export const ACCOUNT_RAIL_KEY = 'commish-account-rail';

/** The root's attribute naming the rail the shell shows (nav.ts RAIL_KEYS). */
export const RAIL_ATTR = 'data-rail';

/** The site's rail as the last prerendered page was built, in localStorage: a page the Worker draws
 * in the browser (a league's pages) has no build of its own to say it. The site's season, never the
 * account's. */
export const SITE_RAIL_KEY = 'commish-site-rail';

const json = JSON.stringify;

/** The boot script. `buildRail` is the site's rail at build (the season the run's kickoffs place
 * the build in), null for a page drawn at request time. With a session, the session copy's rail
 * stands (the selected league's phase, else the account's site season), else the account's rail
 * kept for a new tab; signed out, or with neither, the build's (or the last build's). A word that
 * is not a rail key is never taken. */
export function contextBootScript(buildRail: RailKey | null): string {
	return `(function(){try{var d=document.documentElement,l=localStorage,k=${json(RAIL_KEYS)},b=${json(buildRail)};if(b)l.setItem(${json(
		SITE_RAIL_KEY
	)},b);else b=l.getItem(${json(SITE_RAIL_KEY)});var m=document.cookie.match(${json(
		`(?:^|; )${SESSION_CSRF_COOKIE}=([^;]*)`
	)}),r=b;if(m){var n=l.getItem(${json(LINES_KEY)});if(n==='1'||n==='2'||n==='3')d.setAttribute(${json(
		LEAGUE_ATTR
	)},n);var c=JSON.parse(sessionStorage.getItem(${json(CONTEXT_KEY)})||'null'),a=c&&c.session===m[1]?c.rail:l.getItem(${json(
		ACCOUNT_RAIL_KEY
	)});if(k.indexOf(a)>=0)r=a;}if(k.indexOf(r)>=0)d.setAttribute(${json(RAIL_ATTR)},r);}catch(e){}})();`;
}
