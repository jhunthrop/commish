// The fixture's ESPN leagues (Lane 66i review M1): the recorded league's read as an ESPN league
// answers it, so the ESPN screens are drawn and checked as ESPN's. ESPN gives no avatar we show and
// no move history (moves_read false), runs its waivers in an order (each team's place, the last in
// the standings first), and links its own settings page. Two rules stand unstated, as an ESPN league
// leaves rules unset, so the settings show them with no figure. The teams, records and points are
// the recorded Sleeper league's, a stand-in for an ESPN league's.
import type { LeagueSync } from '../../src/lib/league/api.ts';

const ESPN_LEAGUE = '48153503';
const UNSTATED = ['points_per_two_point_conversion', 'points_per_extra_point_missed'];

export function espnSync(sync: LeagueSync): LeagueSync {
	const last = sync.teams.length;
	return {
		...sync,
		host: 'espn',
		host_league_id: ESPN_LEAGUE,
		name: 'Office League (ESPN stand-in)',
		teams: sync.teams.map((team, i) => ({
			...team,
			avatar: null,
			waiver_budget_left: null,
			waiver_order: last - i
		})),
		moves: [],
		moves_read: false,
		terms: {
			...sync.terms,
			waivers: 'order',
			waiver_budget: null,
			scoring_unstated: UNSTATED,
			scoring_extra: [],
			host_settings_url: `https://fantasy.espn.com/football/league/settings?leagueId=${ESPN_LEAGUE}`
		}
	};
}
