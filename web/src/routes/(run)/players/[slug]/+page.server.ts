import { buildInstant } from '#lib/server/build-clock.ts';
import { playerEntries, playerPage } from '#lib/server/pages/player.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = playerEntries;

/** A page the nightly held back and shows from an earlier run's copy (Lane 136) carries that run's
 * stamp, so it says it is older than the rest of the site. */
export const load: PageServerLoad = async ({ params, parent }) => {
	const [page, { run }] = await Promise.all([playerPage(params.slug, buildInstant()), parent()]);
	return { page, run: page.copyOf === null ? run : { ...run, ...page.copyOf } };
};
