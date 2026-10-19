import { buildInstant } from '#lib/server/build-clock.ts';
import { adpPage } from '#lib/server/pages/adp.ts';
import { defaultFormat } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** ADP for the default format, the same page as /adp/<format>. */
export const load: PageServerLoad = async () => ({
	page: await adpPage((await defaultFormat()).id, buildInstant())
});
