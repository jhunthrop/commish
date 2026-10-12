import type { Handle } from '@sveltejs/kit/hooks';
import { THEME_BOOT_SCRIPT } from '#lib/ui/theme.ts';

const THEME_BOOT_PLACEHOLDER = '%commish.themeBoot%';
/** The core subsets of the two UI faces, the only fonts a first paint needs. */
const FIRST_PAINT_FONT = /-core\.[\w-]+\.woff2$/;

/** Puts the theme boot script into every page, prerendered or not, from the one definition in
 * theme.ts, and preloads scripts, styles and the first-paint fonts. */
export const handle: Handle = ({ event, resolve }) =>
	resolve(event, {
		transformPageChunk: ({ html }) => html.replace(THEME_BOOT_PLACEHOLDER, THEME_BOOT_SCRIPT),
		preload: ({ type, path }) =>
			type === 'js' || type === 'css' || (type === 'font' && FIRST_PAINT_FONT.test(path))
	});
