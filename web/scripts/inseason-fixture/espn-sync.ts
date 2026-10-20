// The fixture's ESPN leagues (Lane 66i review M1): the recorded league's read as an ESPN league
// answers it, so the ESPN screens are drawn and checked as ESPN's. ESPN gives no avatar we show and
// no move history (moves_read false), runs its waivers in an order (each team's place, the last in
// the standings first), and links its own settings page. Two rules stand unstated, as an ESPN league
// leaves rules unset, so the settings show them with no figure, beside the recorded league's own
// unstated rule. The teams, records and points are
// the recorded Sleeper league's, a stand-in for an ESPN league's.
import type { LeagueSync, MatchupSide } from '../../src/lib/league/api.ts';
import type { MatchupBox } from '../../src/lib/league/inseason/api.ts';

const ESPN_LEAGUE = '48153503';
/** The stand-in league's name, in its read and in the switch's list. */
export const ESPN_STAND_IN_NAME = 'Office League (ESPN stand-in)';
const UNSTATED = ['points_per_two_point_conversion', 'points_per_extra_point_missed'];

/** ESPN sends each side's own total beside its players' points: the score is ESPN's (Lane 79). */
const espnSide = (side: MatchupSide): MatchupSide => ({ ...side, team_total: true });

/** The Matchup's box as the API answers an ESPN league: each side's total ESPN's own. */
export function espnMatchup(box: MatchupBox): MatchupBox {
	return { ...box, sides: box.sides.map((s) => ({ ...s, team_total: true })) };
}

export function espnSync(sync: LeagueSync): LeagueSync {
	const last = sync.teams.length;
	const week = sync.matchup;
	return {
		...sync,
		matchup:
			week === null
				? null
				: {
						...week,
						mine: espnSide(week.mine),
						opponent: week.opponent && espnSide(week.opponent)
					},
		host: 'espn',
		host_league_id: ESPN_LEAGUE,
		name: ESPN_STAND_IN_NAME,
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
			// The last in the standings first, as waiverOrderReset true reads (Lane 104). No tiebreak,
			// as a read without playoffSeedingRule, so the basis says ESPN lists ties on points for.
			waiver_order: 'inverse_standings',
			waiver_budget: null,
			// The recorded league's own unstated rule stays unstated, with ESPN's two beside it.
			scoring_unstated: [...sync.terms.scoring_unstated, ...UNSTATED],
			scoring_extra: [],
			host_settings_url: `https://fantasy.espn.com/football/league/settings?leagueId=${ESPN_LEAGUE}`
		}
	};
}
