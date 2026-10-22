import { legalHrefs } from '#lib/legal/legal-hrefs.ts';
import { PRIVACY } from '#lib/legal/privacy-words.ts';
import { buildWeekLabel } from '#lib/server/build-week.ts';
import type { PageServerLoad } from './$types';

/** The words and their links built at prerender (legal-hrefs.ts), and the rail's week item named at
 * build so the shell paints it (Lane 143, B126). */
export const load: PageServerLoad = async () => ({
	...(await buildWeekLabel()),
	doc: PRIVACY,
	hrefs: legalHrefs()
});
