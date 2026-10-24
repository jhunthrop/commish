import { buildWeekLabel } from '#lib/server/build-week.ts';
import { STATIC_HEADS } from '#lib/server/pages/head.ts';
import type { PageServerLoad } from './$types';

/** The rail's week item named at build, so the prerendered shell paints it (Lane 143, B126), and the
 * page's head (Lane 169). */
export const load: PageServerLoad = async () => ({
	...(await buildWeekLabel()),
	head: STATIC_HEADS.sheet()
});
