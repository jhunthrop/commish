import { stamp } from '#lib/server/run.ts';
import type { LayoutServerLoad } from './$types';

/** Every nightly page is built once from the run and served as a static file (spec §2.1). */
export const prerender = true;

export const load: LayoutServerLoad = async () => ({ run: await stamp() });
