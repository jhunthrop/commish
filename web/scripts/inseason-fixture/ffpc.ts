// An FFPC stand-in of the recorded league (Lane 94): the Yahoo stand-in's team totals, no player's
// points (FFPC's pages give each team's total alone), answered as FFPC's: the playoffs seeded as the
// Big Gorilla's rules page states them (seeds 1 and 3 on record, 2 and 4 on points, weeks 13 to 14,
// no cut by record) and the week's projection read in PPR beside FFPC's half point more a tight end's
// catch. The stand-in API answers the recorded league so when the browser asks with the
// fixture_platform=ffpc cookie.
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type {
	GameState,
	LineupAdvice,
	MatchupBox,
	PlayerLine,
	Scoreboard
} from '../../src/lib/league/inseason/api.ts';
import { listedGameOf, scheduleStateOf } from './scoreboard-at.ts';
import { weekDoneState, type Moment } from './sunday.ts';
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
 * starters_final for it (scoreboard.go), and the side's figures are its total alone; its state is
 * the schedule's, by its roster's games (Lane 124, B102). */
function hiddenSide(side: ScoreboardSide, state: GameState): ScoreboardSide {
	const rest: ScoreboardSide = { ...side };
	delete rest.starters_final;
	return {
		...rest,
		starters: 0,
		played: 0,
		to_play: null,
		in_play: 0,
		projected_final: null,
		schedule_state: state
	};
}

/** The FFPC stand-in after its Sunday (Lane 121 fix round 2): the recorded week at the clock as FFPC's,
 * the opponent's starters unlisted on the Matchup and the member's scoreboard game. FFPC's rosters page
 * still carries the opponent's roster (ffpcsnap.go), so the Matchup's bench for him is every player he
 * has and his state the schedule's by their games at the moment (Lane 124, B102); the member's game is
 * final only once both sides are, and the Lineup's Locked or Final follows it. No standing or Decided:
 * the API needs both sides' starters for them. */
export function ffpcAfterSunday(
	week: {
		sync: LeagueSync;
		lineup: LineupAdvice;
		matchup: MatchupBox;
		scoreboard: Scoreboard;
	},
	moment: Pick<Moment, 'now' | 'final'>
): { sync: LeagueSync; lineup: LineupAdvice; matchup: MatchupBox; scoreboard: Scoreboard } {
	const ffpc = ffpcStandIn(week);
	const me = week.sync.me;
	const roster = (s: MatchupBox['sides'][number]): PlayerLine[] => [
		...s.starters.map((st) => st.line),
		...s.bench
	];
	const mine = ffpc.matchup.sides.find((s) => s.roster_id === me);
	const states = new Map(
		ffpc.matchup.sides
			.filter((s) => s.roster_id !== me)
			.map((s) => [s.roster_id, scheduleStateOf(roster(s), moment)] as const)
	);
	const game = listedGameOf(
		mine?.starters.map((st) => st.line) ?? [],
		[...states.values()],
		moment
	);
	const scoreboard: Scoreboard = {
		...week.scoreboard,
		projection_scoring: ffpc.lineup.projection_scoring,
		games: week.scoreboard.games.map((g) =>
			g.sides.some((s) => s.roster_id === me)
				? {
						...g,
						...game,
						sides: g.sides.map((s) =>
							s.roster_id === me ? s : hiddenSide(s, states.get(s.roster_id) ?? 'upcoming')
						)
					}
				: g
		)
	};
	const done = ffpc.lineup.week_done_state ?? null;
	return {
		...ffpc,
		lineup: {
			...ffpc.lineup,
			week_done_state: done === null ? null : weekDoneState(scoreboard, me, done === 'final')
		},
		matchup: {
			...ffpc.matchup,
			// The API says no standing with a side listing no starters (standing.go standingOf).
			standing: null,
			decided: null,
			sides: ffpc.matchup.sides.map((s) =>
				s.roster_id === me
					? s
					: {
							...s,
							starters: [],
							bench: roster(s),
							// No starter of his to count (matchup.go toPlay over none).
							to_play: null,
							projected_final: null,
							schedule_state: states.get(s.roster_id) ?? 'upcoming'
						}
			)
		},
		scoreboard
	};
}
