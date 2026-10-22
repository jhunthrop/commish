import { seasonFirst } from '#lib/context/first-season.ts';
import type { LayoutLoad } from './$types';

/** The rooms are the drafter's own: rendered in the browser against the API, never prerendered. */
export const ssr = false;
export const prerender = false;

/** The site's season first, so the rail names the week on the first paint (Lane 143, B126). */
export const load: LayoutLoad = seasonFirst;
