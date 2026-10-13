import { adpEntries, adpPage } from '#lib/server/pages/adp.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = adpEntries;

export const load: PageServerLoad = async ({ params }) => ({ page: await adpPage(params.format) });
