// An FFPC stand-in of the recorded league (Lane 94): the Yahoo stand-in's team totals, no player's
// points (FFPC's pages give each team's total alone), answered as FFPC's: the playoffs seeded as the
// Big Gorilla's rules page states them (seeds 1 and 3 on record, 2 and 4 on points, weeks 13 to 14,
// no cut by record) and the week's projection read in PPR beside FFPC's half point more a tight end's
// catch. The stand-in API answers the recorded league so when the browser asks with the
// fixture_platform=ffpc cookie.
import { readFileSync } from 'node:fs';
import type { LeagueSync } from '../../src/lib/league/api.ts';
import type {
	GameState,
	LineupAdvice,
	MatchupBox,
	PlayerLine,
	Scoreboard
} from '../../src/lib/league/inseason/api.ts';
import { listedGameOf, scheduleStateOf, type SleeperMatchup } from './scoreboard-at.ts';
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

/** A side FFPC's read lists no starters for (Lane 121 fix round 2, HIGH-2): FFPC shows us the member's
 * lineup only, so the API sends no box starters, no starters_final, no Proj and no projected final for
 * it (scoreboard.go, projfinal.go, Lane 125), and the side's figures are its total alone; its state is
 * the schedule's (Lane 124, B102). */
function hiddenSide(side: ScoreboardSide, state: GameState): ScoreboardSide {
	const rest: ScoreboardSide = { ...side };
	delete rest.starters_final;
	return {
		...rest,
		starters: 0,
		played: 0,
		projection: null,
		to_play: null,
		in_play: 0,
		projected_final: null,
		schedule_state: state
	};
}

/** The teams whose roster FFPC's rosters page does not carry in the stand-in (Lane 125, B104), by
 * roster id: of the five games beside the member's, 11 v 12 and 5 v 10 keep both rosters, 4 v 8 and
 * 2 v 6 have none, and 3 v 9 one, so the week-wide rule draws beside the roster rule on one board. */
export const FFPC_ROSTERLESS: ReadonlySet<number> = new Set([4, 8, 2, 6, 9]);

/** A club's game of the week as the stored schedule holds it (data/games.json). */
interface WeekGame {
	opponent: string | null;
	kickoff: string | null;
	played: boolean;
}

const WEEK_GAMES = (
	JSON.parse(readFileSync(new URL('./data/games.json', import.meta.url), 'utf8')) as {
		games: WeekGame[];
	}
).games;

/** The week's games, one a club, as lines on a template line (only its facts are read): the schedule
 * a side reads by where the read carries no roster for it (schedule_state.go scheduleRead, every game
 * of the week). */
function weekLines(template: PlayerLine): PlayerLine[] {
	return WEEK_GAMES.map((g) => ({
		...template,
		facts: {
			...template.facts,
			opponent: g.opponent,
			kickoff: g.kickoff,
			played: g.played,
			bye: false,
			designation: null
		}
	}));
}

/** The recorded week's rosters (the Sleeper replay's matchups) and every line the answers hold. */
export interface RecordedRosters {
	matchups: readonly SleeperMatchup[];
	lines: ReadonlyMap<string, PlayerLine>;
}

/** A Matchup side's whole roster, its starters and its bench. */
function boxRoster(s: MatchupBox['sides'][number]): PlayerLine[] {
	return [...s.starters.map((st) => st.line), ...s.bench];
}

/** Each side's schedule lines by the API's rule (scheduleRead): its roster's games where FFPC carries
 * the roster (the member's opponent's as the Matchup benches it, the rest from the recorded rosters),
 * else every game of the week. */
function scheduleReads(
	recorded: RecordedRosters,
	matchup: MatchupBox,
	template: PlayerLine
): (rosterId: number) => readonly PlayerLine[] {
	const week = weekLines(template);
	const boxed = new Map(matchup.sides.map((s) => [s.roster_id, boxRoster(s)] as const));
	const players = new Map(recorded.matchups.map((m) => [m.roster_id, m.players] as const));
	return (rosterId) => {
		if (FFPC_ROSTERLESS.has(rosterId)) return week;
		const roster =
			boxed.get(rosterId) ??
			(players.get(rosterId) ?? []).flatMap((id) => recorded.lines.get(id) ?? []);
		return roster.length > 0 ? roster : week;
	};
}

/** The FFPC stand-in after its Sunday (Lane 121 fix round 2): the recorded week at the clock as FFPC's,
 * every side's starters unlisted but the member's (ffpcsnap.go ownLineupOnly), on the Matchup and every
 * game of the scoreboard (Lane 125, B104). FFPC's rosters page carries a roster for most teams, so the
 * Matchup's bench for the opponent is every player he has, and a side's state is the schedule's by its
 * roster's games at the moment, by the week's where the page carries none (Lane 124, B102); a game is
 * final only once both sides are, and the Lineup's Locked or Final follows the member's. No standing or
 * Decided: the API needs both sides' starters for them. */
export function ffpcAfterSunday(
	week: {
		sync: LeagueSync;
		lineup: LineupAdvice;
		matchup: MatchupBox;
		scoreboard: Scoreboard;
	},
	moment: Pick<Moment, 'now' | 'final'>,
	recorded: RecordedRosters
): { sync: LeagueSync; lineup: LineupAdvice; matchup: MatchupBox; scoreboard: Scoreboard } {
	const ffpc = ffpcStandIn(week);
	const me = week.sync.me;
	const listed = ffpc.matchup.sides.find((s) => s.roster_id === me)?.starters.map((st) => st.line);
	const template = listed?.[0];
	if (template === undefined)
		throw new Error('the FFPC stand-in needs the member starting a player');
	const reads = scheduleReads(recorded, ffpc.matchup, template);
	const stateOf = (rosterId: number): GameState => scheduleStateOf(reads(rosterId), moment);
	const gameOf = (g: Scoreboard['games'][number]): Scoreboard['games'][number] => {
		const mine = g.sides.some((s) => s.roster_id === me);
		const unlisted = g.sides.filter((s) => s.roster_id !== me).map((s) => reads(s.roster_id));
		return {
			...g,
			...listedGameOf(mine ? (listed ?? []) : [], unlisted, moment),
			// No starter listed on either side: nothing to count (scoreboard.go toPlay over none).
			to_play: mine ? g.to_play : null,
			sides: g.sides.map((s) => (s.roster_id === me ? s : hiddenSide(s, stateOf(s.roster_id))))
		};
	};
	const scoreboard: Scoreboard = {
		...week.scoreboard,
		projection_scoring: ffpc.lineup.projection_scoring,
		games: week.scoreboard.games.map(gameOf)
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
							bench: boxRoster(s),
							// No starter of his to count (matchup.go toPlay over none).
							to_play: null,
							projected_final: null,
							schedule_state: stateOf(s.roster_id)
						}
			)
		},
		scoreboard
	};
}
