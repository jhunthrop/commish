import { buildInstant } from '#lib/server/build-clock.ts';
import { boardEntries, boardPage } from '#lib/server/pages/board.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = boardEntries;

export const load: PageServerLoad = async ({ params }) => ({
	page: await boardPage(params.format, params.position, buildInstant())
});
