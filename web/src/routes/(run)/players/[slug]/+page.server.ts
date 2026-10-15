import { resolve } from '$app/paths';
import { playerEntries, playerPage } from '#lib/server/pages/player.ts';
import { SOURCES_TITLE } from '#lib/site/sources.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = playerEntries;

/** Where his read's figures come from, the link under it: its words and address come from the
 * server, so the credit list never ships in the player page's script. */
const SOURCES_LINK = { href: resolve('/data'), words: SOURCES_TITLE } as const;

export const load: PageServerLoad = async ({ params }) => ({
	page: await playerPage(params.slug),
	sources: SOURCES_LINK
});
