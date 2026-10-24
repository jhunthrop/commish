import { STATIC_HEADS } from '#lib/server/pages/head.ts';
import type { PageServerLoad } from './$types';

/** The print view's head, built at prerender (Lane 169). */
export const load: PageServerLoad = () => ({ head: STATIC_HEADS.print() });
