/** A followed league's pages, as the tabs under its title list them: the league page (standings,
 * roster, matchup, moves, pool) and the three in-season screens. Kept with the league's parts, not
 * with the site's links, so no other page carries them. */
import { resolve } from '$app/paths';
import type { InSeasonScreen } from './words.ts';

export type LeagueTab = 'league' | InSeasonScreen;

export interface LeagueTabLink {
	tab: LeagueTab;
	label: string;
	href: (id: string) => string;
}

export const LEAGUE_TABS: readonly LeagueTabLink[] = [
	{ tab: 'league', label: 'League', href: (id) => resolve('/league/[id]', { id }) },
	{ tab: 'start', label: 'Start and sit', href: (id) => resolve('/league/[id]/start', { id }) },
	{ tab: 'waivers', label: 'Waivers', href: (id) => resolve('/league/[id]/waivers', { id }) },
	{ tab: 'trades', label: 'Trades', href: (id) => resolve('/league/[id]/trades', { id }) }
];

/** A tab's page for a league. */
export function tabHref(tab: LeagueTab, id: string): string {
	const found = LEAGUE_TABS.find((t) => t.tab === tab);
	if (!found) throw new Error(`No league tab ${tab}.`);
	return found.href(id);
}
