/** The three in-season screens as their route's segment names them, and which of them are pages
 * under the flag. Alone and free of run-time imports, so the route's load carries only this. */
import type { Flag } from '#lib/site/flags.ts';

const SCREENS = ['start', 'waivers', 'trades'] as const;

/** A screen, by the decision it makes. */
export type InSeasonScreen = (typeof SCREENS)[number];

/** Whether a route's segment names an in-season screen. */
export function isScreen(segment: string): segment is InSeasonScreen {
	return (SCREENS as readonly string[]).includes(segment);
}

/** The screen a route segment names, null for any other segment or with the in-season tools off:
 * the site's own not-found answers then. */
export function screenOf(
	segment: string,
	flags: Readonly<Record<Flag, boolean>>
): InSeasonScreen | null {
	return flags.in_season_tools && isScreen(segment) ? segment : null;
}
