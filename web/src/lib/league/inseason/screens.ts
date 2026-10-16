/** A followed league's screens as their route's segment names them: the three that advise (start
 * and sit, waivers, trades) and the week's matchup, and which of them are pages under the flag.
 * Alone and free of run-time imports, so the route's load carries only this. */
import type { Flag } from '#lib/site/flags.ts';
import type { LeagueScreen } from '#lib/ui/nav.ts';

const SCREENS = [
	'start',
	'matchup',
	'waivers',
	'trades'
] as const satisfies readonly LeagueScreen[];

/** A screen that answers with our advice, by the decision it makes. */
export type InSeasonScreen = Exclude<LeagueScreen, 'matchup'>;

export type { LeagueScreen };

/** Whether a route's segment names a league screen. */
export function isScreen(segment: string): segment is LeagueScreen {
	return (SCREENS as readonly string[]).includes(segment);
}

/** The screen a route segment names, null for any other segment or with the in-season tools off:
 * the site's own not-found answers then. */
export function screenOf(
	segment: string,
	flags: Readonly<Record<Flag, boolean>>
): LeagueScreen | null {
	return flags.in_season_tools && isScreen(segment) ? segment : null;
}
