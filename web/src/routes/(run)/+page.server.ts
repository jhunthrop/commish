import { buildInstant } from '#lib/server/build-clock.ts';
import { frontPage } from '#lib/server/pages/front.ts';
import { frontHead } from '#lib/server/pages/head.ts';
import type { PageServerLoad } from './$types';

/** The front door, built from the run like every nightly page, with its head (Lane 169). */
export const load: PageServerLoad = async ({ parent }) => {
	const [page, { run }] = await Promise.all([frontPage(buildInstant()), parent()]);
	return { page, head: frontHead(page.format, run.season) };
};
