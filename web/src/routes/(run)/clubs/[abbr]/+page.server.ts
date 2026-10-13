import { clubEntries, clubPage } from '#lib/server/pages/clubs.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = clubEntries;

export const load: PageServerLoad = async ({ params }) => ({ page: await clubPage(params.abbr) });
