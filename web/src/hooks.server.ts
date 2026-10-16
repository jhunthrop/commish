import { building } from '$app/env';
import type { Handle } from '@sveltejs/kit/hooks';
import { contextBootScript } from '#lib/context/boot.ts';
import { appHeadTags } from '#lib/site/app-manifest.ts';
import { railCss } from '#lib/ui/rail-css.ts';
import { railSprite } from '#lib/ui/rail-icons.ts';
import { THEME_BOOT_SCRIPT } from '#lib/ui/theme.ts';

const THEME_BOOT_PLACEHOLDER = '%commish.themeBoot%';
const APP_HEAD_PLACEHOLDER = '%commish.appHead%';
const RAIL_SPRITE_PLACEHOLDER = '%commish.railSprite%';
/** The rail's glyphs, once a page at the top of its body (rail-icons.ts). */
const RAIL_SPRITE = railSprite();
/** Built once: the manifest link, the chrome's colours and the rail's place in every season phase
 * (rail-css.ts) are the same on every page, and none of them is in a page's script. */
const APP_HEAD = `${appHeadTags()}<style>${railCss()}</style>`;

/** Puts the theme's and the league context's boot scripts into every page, prerendered or not, each
 * from its one definition (theme.ts, context/boot.ts), the context's with the site's rail at build
 * for a prerendered page (server/site-rail.ts, read only while building), and the installable app's head tags
 * (site/app-manifest.ts) in the HTML, so no page's script carries them; and preloads the styles and nothing else. Measured on a throttled phone (Lane 5):
 * preloaded fonts made Chrome hold a light page's first paint until they landed, about 1.66 s
 * instead of 0.7 s in half the runs, and preloaded scripts took the bandwidth the fonts needed.
 * Unpreloaded, the page paints in the fallback face at once and swaps when the fonts arrive. */
export const handle: Handle = async ({ event, resolve }) => {
	const rail = building ? await (await import('#lib/server/site-rail.ts')).buildSiteRail() : null;
	const boot = THEME_BOOT_SCRIPT + contextBootScript(rail);
	return resolve(event, {
		transformPageChunk: ({ html }) =>
			html
				.replace(THEME_BOOT_PLACEHOLDER, boot)
				.replace(APP_HEAD_PLACEHOLDER, APP_HEAD)
				.replace(RAIL_SPRITE_PLACEHOLDER, RAIL_SPRITE),
		preload: ({ type }) => type === 'css'
	});
};
