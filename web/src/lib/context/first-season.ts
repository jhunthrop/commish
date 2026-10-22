/** The load of every page the Worker draws in the browser (league, mock, lobby, companion, claim):
 * the site's season is the page's first data (Lane 143, B126), so the rail's week item is named
 * "Week 7 rankings" on the first paint, never "Players" first and renamed once the season answers.
 * A prerendered page names the week from its build (run/week-names.ts). */
import type { components } from '#lib/api/types.ts';
import { siteContext } from './context.svelte.ts';

type SiteSeason = components['schemas']['SiteSeason'];

export async function seasonFirst(): Promise<{ season: SiteSeason | null }> {
	return { season: await siteContext.firstSeason() };
}
