import { boardFormatEntries, boardRoute } from '#lib/server/pages/board.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = boardFormatEntries;

export const load: PageServerLoad = async ({ params }) => ({
	view: await boardRoute(params.format)
});
