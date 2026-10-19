import { buildInstant } from '#lib/server/build-clock.ts';
import { boardPage } from '#lib/server/pages/board.ts';
import { defaultFormat } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** The rail's Board: the default format's whole board, the same page as /board/<format>. */
export const load: PageServerLoad = async () => ({
	page: await boardPage((await defaultFormat()).id, null, buildInstant())
});
