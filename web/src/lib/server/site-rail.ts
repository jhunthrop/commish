/** The rail every prerendered page is built with: the site's season at the build's clock, from the
 * run's kickoffs (site-season.ts). Read once a build. Only the build reads it (hooks.server.ts):
 * a page drawn at request time has no run, and the boot script takes the last build's from the
 * browser. */
import { siteRailAt } from '#lib/run/site-season.ts';
import type { RailKey } from '#lib/ui/nav.ts';
import { schedule } from './run.ts';

let rail: Promise<RailKey> | null = null;

export function buildSiteRail(now: Date): Promise<RailKey> {
	rail ??= schedule().then((slate) => {
		const kickoffs = slate.slates.flatMap((club) => club.games.map((game) => game.kickoff));
		return siteRailAt(now, kickoffs);
	});
	return rail;
}
