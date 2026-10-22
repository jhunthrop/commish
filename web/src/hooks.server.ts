import { building } from '$app/env';
import type { Handle } from '@sveltejs/kit/hooks';
import { buildInstant } from '#lib/server/build-clock.ts';
import { asksForPage, notFoundPage } from '#lib/server/not-found.ts';
import { pageChunk } from '#lib/server/page-chunk.ts';

/** Finishes every page, prerendered or not (server/page-chunk.ts), with the site's rail at build for
 * a prerendered page (server/site-rail.ts, read only while building); and preloads the styles and
 * nothing else. Measured on a throttled phone (Lane 5): preloaded fonts made Chrome hold a light
 * page's first paint until they landed, about 1.66 s instead of 0.7 s in half the runs, and
 * preloaded scripts took the bandwidth the fonts needed. Unpreloaded, the page paints in the
 * fallback face at once and swaps when the fonts arrive. */
export const handle: Handle = async ({ event, resolve }) => {
	// A page that does not exist: the prerendered not-found page with a 404 (server/not-found.ts).
	if (!building && event.route.id === null && asksForPage(event.request)) {
		const missing = await notFoundPage(event.platform?.env.ASSETS, event.request);
		if (missing !== null) return missing;
	}
	const rail = building
		? await (await import('#lib/server/site-rail.ts')).buildSiteRail(new Date(buildInstant()))
		: null;
	return resolve(event, {
		transformPageChunk: ({ html }) => pageChunk(html, rail),
		preload: ({ type }) => type === 'css'
	});
};
