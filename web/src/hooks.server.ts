import type { Handle } from '@sveltejs/kit/hooks';
import { THEME_BOOT_SCRIPT } from '#lib/ui/theme.ts';

const THEME_BOOT_PLACEHOLDER = '%commish.themeBoot%';

/** Puts the theme boot script into every page, prerendered or not, from the one definition in
 * theme.ts, and preloads the styles and nothing else. Measured on a throttled phone (Lane 5):
 * preloaded fonts made Chrome hold a light page's first paint until they landed, about 1.66 s
 * instead of 0.7 s in half the runs, and preloaded scripts took the bandwidth the fonts needed.
 * Unpreloaded, the page paints in the fallback face at once and swaps when the fonts arrive. */
export const handle: Handle = ({ event, resolve }) =>
	resolve(event, {
		transformPageChunk: ({ html }) => html.replace(THEME_BOOT_PLACEHOLDER, THEME_BOOT_SCRIPT),
		preload: ({ type }) => type === 'css'
	});
