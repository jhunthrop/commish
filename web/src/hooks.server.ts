import type { Handle } from '@sveltejs/kit/hooks';
import { THEME_BOOT_SCRIPT } from '#lib/ui/theme.ts';

const THEME_BOOT_PLACEHOLDER = '%commish.themeBoot%';
/** The core subsets of the two UI faces, the only fonts a first paint needs. */
const FIRST_PAINT_FONT = /-core\.[\w-]+\.woff2$/;

/** Puts the theme boot script into every page, prerendered or not, from the one definition in
 * theme.ts, and preloads styles and the first-paint fonts. Scripts are not preloaded: on a
 * throttled phone they would share the first second's bandwidth with the fonts, the fonts would
 * land after the first paint, and the swap would repaint the page's text as a later, larger paint.
 * The script still starts as soon as the page is parsed, and hydration waits a little instead. */
export const handle: Handle = ({ event, resolve }) =>
	resolve(event, {
		transformPageChunk: ({ html }) => html.replace(THEME_BOOT_PLACEHOLDER, THEME_BOOT_SCRIPT),
		preload: ({ type, path }) => type === 'css' || (type === 'font' && FIRST_PAINT_FONT.test(path))
	});
