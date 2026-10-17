/** A followed league's tabs (tab-list.ts) and each tab's page: the screens share one route
 * (/league/[id]/[screen]). Kept with the league's parts, so no other page carries them. */
import { resolve } from '$app/paths';
import type { LeagueTab } from './tab-list.ts';

export {
	TRADE_FOR_PARAM,
	WAIVERS_AT_PARAM,
	leagueScreens,
	leagueTabs,
	type LeagueTab,
	type LeagueTabLink,
	type TabPhase
} from './tab-list.ts';

/** A tab's page for a league. */
export function tabHref(tab: LeagueTab, id: string): string {
	return tab === 'league'
		? resolve('/league/[id]', { id })
		: resolve('/league/[id]/[screen]', { id, screen: tab });
}
