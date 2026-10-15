import { stamp } from '#lib/server/run.ts';
import type { PageServerLoad } from './$types';

/** Where the numbers come from: a static page, built once with the run's stamp in its bar. */
export const prerender = true;

export const load: PageServerLoad = async () => ({ run: await stamp() });
