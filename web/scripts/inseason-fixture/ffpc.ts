// An FFPC stand-in of the recorded league (Lane 94): the Yahoo stand-in's team totals, no player's
// points (FFPC's pages give each team's total alone), answered as FFPC's: the playoffs seeded as the
// Big Gorilla's rules page states them (seeds 1 and 3 on record, 2 and 4 on points, weeks 13 to 14,
// no cut by record) and the week's projection read in PPR beside FFPC's half point more a tight end's
// catch. The stand-in API answers the recorded league so when the browser asks with the
// fixture_platform=ffpc cookie.
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type { LineupAdvice, MatchupBox, Scoreboard } from '../../src/lib/league/inseason/api.ts';
import { yahooStandIn } from './yahoo.ts';

/** FFPC's tight end premium over PPR, the Big Gorilla's official rules (1.5 a catch for a TE). */
const FFPC_TE_BONUS = 0.5;

/** The recorded league's read, Lineup and Matchup as an FFPC league's. */
export function ffpcStandIn(recorded: {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
}): {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
} {
	const totals = yahooStandIn(recorded);
	const scoring = {
		...totals.lineup.projection_scoring,
		league_own: false,
		te_bonus: FFPC_TE_BONUS
	};
	return {
		sync: {
			...totals.sync,
			host: 'ffpc',
			terms: {
				...totals.sync.terms,
				playoff_teams: null,
				playoff_weeks: { first: 13, last: 14 },
				playoff_seeds: ['record', 'points', 'record', 'points']
			}
		},
		lineup: {
			...totals.lineup,
			projection_scoring: scoring,
			moves: { ...totals.lineup.moves, reason: 'FFPC takes no lineups from here.' }
		},
		matchup: { ...totals.matchup, projection_scoring: scoring }
	};
}

type ScoreboardSide = Scoreboard['games'][number]['sides'][number];

/** The opponent as FFPC's read holds it (Lane 121 fix round 2, HIGH-2): FFPC shows us the member's
 * lineup only, so the platform lists the opponent no starters, the API sends no box starters and no
 * starters_final for it (scoreboard.go), and the side's figures are its total alone. */
function hiddenSide(side: ScoreboardSide): ScoreboardSide {
	const rest: ScoreboardSide = { ...side };
	delete rest.starters_final;
	return { ...rest, starters: 0, played: 0, to_play: null, in_play: 0, projected_final: null };
}

/** The FFPC stand-in after its Sunday (Lane 121 fix round 2): the recorded week at the clock as FFPC's,
 * the opponent's starters unlisted on the Matchup and the member's scoreboard game. */
export function ffpcAfterSunday(week: {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
	scoreboard: Scoreboard;
}): { sync: LeagueSync; lineup: LineupAdvice; matchup: MatchupBox; scoreboard: Scoreboard } {
	const ffpc = ffpcStandIn(week);
	const me = week.sync.me;
	return {
		...ffpc,
		matchup: {
			...ffpc.matchup,
			sides: ffpc.matchup.sides.map((s) =>
				s.roster_id === me ? s : { ...s, starters: [], bench: [], projected_final: null }
			)
		},
		scoreboard: {
			...week.scoreboard,
			projection_scoring: ffpc.lineup.projection_scoring,
			games: week.scoreboard.games.map((g) =>
				g.sides.some((s) => s.roster_id === me)
					? { ...g, sides: g.sides.map((s) => (s.roster_id === me ? s : hiddenSide(s))) }
					: g
			)
		}
	};
}
