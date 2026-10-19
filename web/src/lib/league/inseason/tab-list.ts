/** A followed league's screens in its phase, in its rail's order (spec 2026-10-16 §3): Lineup,
 * Matchup, Waivers and Trades in season, waivers in the playoffs only while the platform runs them,
 * none before the draft or after the season. The rail is the one way between them (Lane 66r); a
 * screen reads this to send a league switched to without it to its league page. Pure, so the tests
 * read it. */
import type { ContextLeague } from '#lib/context/words.ts';
import { LEAGUE_HOME } from '#lib/ui/nav.ts';
import { railFor } from '#lib/ui/rail-order.ts';
import type { LeagueScreen } from './screens.ts';

/** What a league's screens read of it: its phase, and whether its platform still runs waivers. */
export type ScreenPhase = Pick<ContextLeague, 'phase' | 'waivers_open'>;

/** A league's screens in its phase, in its rail's order. */
export function leagueScreens(league: ScreenPhase): LeagueScreen[] {
	return railFor(league.phase, league.waivers_open).flatMap((entry) =>
		entry.screen === undefined || entry.screen === LEAGUE_HOME ? [] : [entry.screen]
	);
}
