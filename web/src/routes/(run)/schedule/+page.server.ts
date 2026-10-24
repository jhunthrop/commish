import { scheduleHead } from '#lib/server/pages/head.ts';
import { schedulePage } from '#lib/server/pages/clubs.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
	const [page, { run }] = await Promise.all([schedulePage(), parent()]);
	return { page, head: scheduleHead(run.season) };
};
