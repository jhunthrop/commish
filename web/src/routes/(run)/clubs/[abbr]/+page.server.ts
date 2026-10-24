import { buildInstant } from '#lib/server/build-clock.ts';
import { clubEntries, clubPage } from '#lib/server/pages/clubs.ts';
import { clubHead } from '#lib/server/pages/head.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = clubEntries;

export const load: PageServerLoad = async ({ params, parent }) => {
	const [page, { run }] = await Promise.all([clubPage(params.abbr, buildInstant()), parent()]);
	return { page, head: clubHead(page.club, page.format, run.season) };
};
