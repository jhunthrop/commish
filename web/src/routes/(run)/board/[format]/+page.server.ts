import { boardPage } from '#lib/server/pages/board.ts';
import { manifest } from '#lib/server/run.ts';
import type { EntryGenerator, PageServerLoad } from './$types';

export const entries: EntryGenerator = async () =>
	(await manifest()).formats.map((format) => ({ format: format.id }));

export const load: PageServerLoad = async ({ params }) => ({
	page: await boardPage(params.format, null)
});
