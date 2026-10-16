/** A followed league's pages, as the tabs under its title list them: the league page (standings,
 * roster, moves, pool) and the screens its phase has, in its rail's order (spec 2026-10-16 §3):
 * Lineup, Matchup, Waivers and Trades in season, waivers in the playoffs only while the host runs
 * them, none before the draft or after the season. Pure, so the tests read it. */
import type { ContextLeague } from '#lib/context/words.ts';
import { railFor } from '#lib/ui/rail-order.ts';
import type { LeagueScreen } from './screens.ts';
import { TAB_LABELS } from './words.ts';

export type LeagueTab = 'league' | LeagueScreen;

export interface LeagueTabLink {
	tab: LeagueTab;
	label: string;
}

/** What a league's tabs read of it: its phase, and whether its host still runs waivers. */
export type TabPhase = Pick<ContextLeague, 'phase' | 'waivers_open'>;

/** A league's screens in its phase, in its rail's order. */
export function leagueScreens(league: TabPhase): LeagueScreen[] {
	return railFor(league.phase, league.waivers_open).flatMap((entry) =>
		entry.screen === undefined ? [] : [entry.screen]
	);
}

/** The tabs a league shows: the league page and its phase's screens, none when it has no screen. */
export function leagueTabs(league: TabPhase): LeagueTabLink[] {
	const screens = leagueScreens(league);
	if (screens.length === 0) return [];
	return (['league', ...screens] as const).map((tab) => ({ tab, label: TAB_LABELS[tab] }));
}
