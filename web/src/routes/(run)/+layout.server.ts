import { buildInstant } from '#lib/server/build-clock.ts';
import { buildWeekNames } from '#lib/server/build-week.ts';
import { stamp } from '#lib/server/run.ts';
import { buildSiteRail } from '#lib/server/site-rail.ts';
import type { LayoutServerLoad } from './$types';

/** Every nightly page is built once from the run and served as a static file (spec §2.1). */
export const prerender = true;

/** The run's stamp, and the site's rail at build, which the pages that follow the season draw their
 * words from until the context says otherwise (site/shown-rail.svelte.ts). */
export const load: LayoutServerLoad = async () => {
	// The Players page's in-season names at the build's clock (Lane 142, ruling 1).
	const [run, siteRail, names] = await Promise.all([
		stamp(),
		buildSiteRail(new Date(buildInstant())),
		buildWeekNames()
	]);
	return {
		run: names === null ? run : { ...run, weekRankings: names.rankings },
		siteRail
	};
};
