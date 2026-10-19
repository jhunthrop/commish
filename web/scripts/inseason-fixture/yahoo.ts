// A Yahoo stand-in of the recorded league (Lane 79 fix 6): the same read answered as a platform that
// sends each team's total alone, no player's points, so the team-totals Pts sentence ("Pts are
// Yahoo's team points, none by player.") keeps a shot within the basis budget. The stand-in API
// answers the recorded league so when the browser asks with the fixture_platform=yahoo cookie.
import type { LeagueSync, MatchupSide } from '../../src/lib/league/api.ts';
import type { LineupAdvice, MatchupBox, PlayerLine } from '../../src/lib/league/inseason/api.ts';

const noPoints = (line: PlayerLine): PlayerLine => ({
	...line,
	facts: { ...line.facts, points_this_week: null }
});

const yahooSide = (side: MatchupSide): MatchupSide => ({
	...side,
	player_points: false,
	team_total: true,
	starters: side.starters.map((st) => ({ ...st, points: null }))
});

/** The recorded league's read, Lineup and Matchup as a Yahoo league's. */
export function yahooStandIn(recorded: {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
}): {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
} {
	const { sync, lineup, matchup } = recorded;
	const week = sync.matchup;
	return {
		sync: {
			...sync,
			host: 'yahoo',
			teams: sync.teams.map((team) => ({ ...team, avatar: null })),
			matchup:
				week === null
					? null
					: {
							...week,
							mine: yahooSide(week.mine),
							opponent: week.opponent && yahooSide(week.opponent)
						}
		},
		lineup: {
			...lineup,
			player_points: false,
			slots: lineup.slots.map((s) => ({
				...s,
				ours: noPoints(s.ours),
				host: s.host === null ? null : noPoints(s.host)
			})),
			bench: lineup.bench.map(noPoints),
			moves: {
				...lineup.moves,
				reason: 'Yahoo does not take lineups from here, so copy the lineup there.'
			}
		},
		matchup: {
			...matchup,
			sides: matchup.sides.map((s) => ({
				...s,
				player_points: false,
				team_total: true,
				starters: s.starters.map((st) => ({ ...st, line: noPoints(st.line) })),
				bench: s.bench.map(noPoints)
			}))
		}
	};
}
