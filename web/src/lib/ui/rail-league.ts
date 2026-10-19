/** The rail's league items as a league's pages read them: the item a page lights and the screen the
 * follow page was sent for. Apart from nav.ts, so the shell's script carries only the items and
 * these ride with the pages that use them. */
import {
	LEAGUE_HOME,
	RAIL_ITEMS,
	type LeaguePage,
	type LeagueScreen,
	type Section
} from './nav.ts';

/** The rail item a league's page lights: Lineup for start, and the rest by their own names. */
export function screenSection(screen: LeaguePage): Section {
	const item = RAIL_ITEMS.find((candidate) => candidate.screen === screen);
	if (!item) throw new Error(`No rail item opens the ${screen} screen.`);
	return item.section;
}

/** The league screen a search parameter names (the follow page's ?screen=), null for any other. */
export function leagueScreenOf(word: string | null): LeagueScreen | null {
	const screen = RAIL_ITEMS.find((item) => item.screen === word)?.screen ?? null;
	return screen === LEAGUE_HOME ? null : screen;
}
