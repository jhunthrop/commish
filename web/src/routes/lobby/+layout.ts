import { seasonFirst } from '#lib/context/first-season.ts';
import type { LayoutLoad } from './$types';

/** A lobby is live and the drafter's own: rendered in the browser against the API and the room
 * service, never prerendered. */
export const ssr = false;
export const prerender = false;

/** The site's season read alongside the page's first read, so the rail names the week once (Lane 143, B126). */
export const load: LayoutLoad = seasonFirst;
