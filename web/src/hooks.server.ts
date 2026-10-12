import type { Handle } from '@sveltejs/kit/hooks';
import { THEME_BOOT_SCRIPT } from '#lib/ui/theme.ts';

const THEME_BOOT_PLACEHOLDER = '%commish.themeBoot%';

/** Puts the theme boot script into every page, prerendered or not, from the one definition in theme.ts. */
export const handle: Handle = ({ event, resolve }) =>
	resolve(event, {
		transformPageChunk: ({ html }) => html.replace(THEME_BOOT_PLACEHOLDER, THEME_BOOT_SCRIPT)
	});
