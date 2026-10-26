import { buildWeekLabel } from '#lib/server/build-week.ts';
import { STATIC_HEADS } from '#lib/server/pages/head.ts';
import type { PageServerLoad } from './$types';

/** The rail's week item named at build, and the page's head, kept out of search. */
export const load: PageServerLoad = async () => ({
	...(await buildWeekLabel()),
	head: STATIC_HEADS.accountDelete()
});
