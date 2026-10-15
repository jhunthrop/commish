/** A followed league's pages, as the tabs under its title list them: the league page (standings,
 * roster, matchup, moves, pool) and the three in-season screens, which share one route
 * (/league/[id]/[screen]). Kept with the league's parts, not with the site's links, so no other
 * page carries them. */
import { resolve } from '$app/paths';
import { TAB_LABELS, type InSeasonScreen } from './words.ts';

export type LeagueTab = 'league' | InSeasonScreen;

export interface LeagueTabLink {
	tab: LeagueTab;
	label: string;
}

const ORDER: readonly LeagueTab[] = ['league', 'start', 'waivers', 'trades'];

export const LEAGUE_TABS: readonly LeagueTabLink[] = ORDER.map((tab) => ({
	tab,
	label: TAB_LABELS[tab]
}));

/** A tab's page for a league. */
export function tabHref(tab: LeagueTab, id: string): string {
	return tab === 'league'
		? resolve('/league/[id]', { id })
		: resolve('/league/[id]/[screen]', { id, screen: tab });
}
