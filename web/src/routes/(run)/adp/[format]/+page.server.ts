import { adpEntries, adpRoute } from '#lib/server/pages/adp.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = adpEntries;

export const load: PageServerLoad = async ({ params }) => ({ view: await adpRoute(params.format) });
