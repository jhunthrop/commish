import { STATIC_HEADS } from '#lib/server/pages/head.ts';
import type { PageServerLoad } from './$types';

/** The landing's head, kept out of search. */
export const load: PageServerLoad = () => ({ head: STATIC_HEADS.appSignedIn() });
