import { stamp } from '#lib/server/run.ts';
import { buildSiteRail } from '#lib/server/site-rail.ts';
import type { LayoutServerLoad } from './$types';

/** Every nightly page is built once from the run and served as a static file (spec §2.1). */
export const prerender = true;

/** The run's stamp, and the site's rail at build, which the pages that follow the season draw their
 * words from until the context says otherwise (site/shown-rail.svelte.ts). */
export const load: LayoutServerLoad = async () => ({
	run: await stamp(),
	siteRail: await buildSiteRail()
});
