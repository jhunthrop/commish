import { playerEntries, playerPage } from '#lib/server/pages/player.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = playerEntries;

export const load: PageServerLoad = async ({ params }) => ({ page: await playerPage(params.slug) });
