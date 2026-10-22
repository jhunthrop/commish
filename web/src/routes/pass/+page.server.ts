import { buildInstant } from '#lib/server/build-clock.ts';
import { buildWeekLabel } from '#lib/server/build-week.ts';
import { freeSeasonAt } from '#lib/pass/free-season.ts';
import type { PageServerLoad } from './$types';

/** The rail's week item named at build, so the prerendered shell paints it (Lane 143, B126), and the
 * free season at the build's clock, so the page paints its words on the first response (Lane 150). */
export const load: PageServerLoad = async () => ({
	...(await buildWeekLabel()),
	freeSeason: freeSeasonAt(new Date(buildInstant()))
});
