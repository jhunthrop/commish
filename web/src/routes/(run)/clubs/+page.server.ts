import { clubsPage } from '#lib/server/pages/clubs.ts';
import { clubsHead } from '#lib/server/pages/head.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const [page, { run }] = await Promise.all([clubsPage(), parent()]);
	return { page, head: clubsHead(page.format, run.season) };
};
