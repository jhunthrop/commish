import type { Handle } from '@sveltejs/kit/hooks';
import { CONTEXT_BOOT_SCRIPT } from '#lib/context/boot.ts';
import { appHeadTags } from '#lib/site/app-manifest.ts';
import { THEME_BOOT_SCRIPT } from '#lib/ui/theme.ts';

const THEME_BOOT_PLACEHOLDER = '%commish.themeBoot%';
const APP_HEAD_PLACEHOLDER = '%commish.appHead%';
/** Built once: the manifest link and the chrome's colours are the same on every page. */
const APP_HEAD = appHeadTags();

/** Puts the theme's and the league context's boot scripts into every page, prerendered or not, each
 * from its one definition (theme.ts, context/boot.ts), and the installable app's head tags
 * (site/app-manifest.ts) in the HTML, so no page's script carries them; and preloads the styles and nothing else. Measured on a throttled phone (Lane 5):
 * preloaded fonts made Chrome hold a light page's first paint until they landed, about 1.66 s
 * instead of 0.7 s in half the runs, and preloaded scripts took the bandwidth the fonts needed.
 * Unpreloaded, the page paints in the fallback face at once and swaps when the fonts arrive. */
export const handle: Handle = ({ event, resolve }) =>
	resolve(event, {
		transformPageChunk: ({ html }) =>
			html
				.replace(THEME_BOOT_PLACEHOLDER, THEME_BOOT_SCRIPT + CONTEXT_BOOT_SCRIPT)
				.replace(APP_HEAD_PLACEHOLDER, APP_HEAD),
		preload: ({ type }) => type === 'css'
	});
