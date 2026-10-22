/** The load of every page the Worker draws in the browser (league, mock, lobby, companion, claim)
 * (Lane 143, B126): it starts the site's season read as the route loads and never waits on it, so the
 * read runs alongside the page's own first read and adds no round trip before the page paints. The
 * rail holds the week item's label unpainted until the season lands (context seasonPending), so it is
 * named once, never "Players" first and renamed. A prerendered page names the week from its build
 * (server/build-week.ts). */
import { siteContext } from './context.svelte.ts';

export function seasonFirst(): void {
	siteContext.firstSeason();
}
