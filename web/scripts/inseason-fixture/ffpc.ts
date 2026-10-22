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
	LineupSlot,
	MatchupBox,
	PlayerLine,
	Scoreboard
} from '../../src/lib/league/inseason/api.ts';
import {
	kickedOffAt,
	listedGameOf,
	scheduleStateOf,
	sitsOut,
	type SleeperMatchup
} from './scoreboard-at.ts';
import { weekDoneState, type Moment } from './sunday.ts';
import { printedProj, seasonStarters, tenth, tierOf, weekStarters } from './week.ts';
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

/** Our best lineup of a roster FFPC carries, and the game's moment: what a side listing no starters
 * projects from (roster_projection.go, Lane 127). */
interface RosterRead {
	roster: readonly PlayerLine[] | null;
	slots: readonly LineupSlot['slot'][];
	moment: Pick<Moment, 'now' | 'final'>;
	/** The game reads kicked off or final by the bug's own rule (scoreboard.go out.State). */
	started: boolean;
}

/** A side FFPC's read lists no starters for (Lane 121 fix round 2, HIGH-2): FFPC shows us the member's
 * lineup only, so the API sends no box starters and no starters_final for it, and the side's points
 * are its total alone; its state is the schedule's (Lane 124, B102). Its Proj and its Proj final are
 * our best lineup's from its roster where FFPC carries one (Lane 127 and fix round 1), none without. */
function hiddenSide(side: ScoreboardSide, state: GameState, read: RosterRead): ScoreboardSide {
	const rest: ScoreboardSide = { ...side };
	delete rest.starters_final;
	delete rest.projection_best_lineup;
	// FFPC's rosters page gives no player's points, and a player we hold no Proj for is no part of a
	// lineup we project (roster_projection.go bestLineup, fix round 3).
	const roster =
		read.roster
			?.filter((l) => printedProj(l) !== null)
			.map((l) => ({ ...l, facts: { ...l.facts, points_this_week: null } })) ?? null;
	const projected = { ...read, roster };
	delete rest.projected_final_paced;
	const final = roster === null ? null : bestLineupFinal(side.points, projected);
	return {
		...rest,
		starters: 0,
		played: 0,
		projection: roster === null ? null : bestLineupProj(roster, read.slots),
		...(roster === null ? {} : { projection_best_lineup: true }),
		...(read.roster !== null && passesOver(read.roster, read.slots)
			? { best_lineup_skipped: true }
			: {}),
		to_play: null,
		in_play: 0,
		projected_final: final,
		...(final !== null && pacedAt(projected) ? { projected_final_paced: true } : {}),
		schedule_state: state
	};
}

/** Whether our best lineup of a roster passes over a player with no Proj who can play
 * (roster_projection.go bestLineup, Lane 137 B107): the fill that counts him starts him, by the week's
 * order (a slot the lineup leaves empty) or the rest of season's. */
function passesOver(roster: readonly PlayerLine[], slots: readonly LineupSlot['slot'][]): boolean {
	const playing = roster.filter((l) => tierOf(l) === 0);
	return [...weekStarters(playing, slots), ...seasonStarters(playing, slots)].some(
		(l) => printedProj(l) === null
	);
}

/** Whether a best lineup's Proj final counts a player in play at his projection's pace
 * (roster_projection.go pacedFinal): one in play, no points read, some of his game left. */
function pacedAt(read: RosterRead): boolean {
	if (read.roster === null) return false;
	return weekStarters(read.roster, read.slots).some((line) => {
		const proj = printedProj(line);
		return (
			proj !== null &&
			line.facts.points_this_week === null &&
			!line.facts.bye &&
			!sitsOut(line) &&
			kickedOffAt(line, read.moment.now) &&
			!read.moment.final(line) &&
			inPlayLeft(line, proj, read.moment.now) > 0
		);
	});
}

/** How long a game is taken to last for an in-play player's pace (roster_projection.go gameLength). */
const GAME_LENGTH_MS = (3 * 60 + 15) * 60 * 1000;

/** What a best lineup's player in play still adds (roster_projection.go inPlayAt): max(0, Proj - Pts)
 * where his points are read, else his Proj times the share of his game left, held between 0 and 1. */
function inPlayLeft(line: PlayerLine, proj: number, now: number): number {
	const pts = line.facts.points_this_week;
	if (pts !== null) return Math.max(0, proj - pts);
	if (line.facts.kickoff === null) return 0;
	const left = 1 - (now - Date.parse(line.facts.kickoff)) / GAME_LENGTH_MS;
	return proj * Math.min(1, Math.max(0, left));
}

/** A best lineup's projected final (roster_projection.go rosterProjectedFinal): once the game has
 * kicked off, FFPC's points so far plus the printed Proj of each player of the lineup still to play
 * and the rest of it for one in play (inPlayLeft), one final or out nothing; null before, or while one
 * still to play has no Proj. */
function bestLineupFinal(points: number, read: RosterRead): number | null {
	if (!read.started || read.roster === null) return null;
	let sum = points;
	for (const line of weekStarters(read.roster, read.slots)) {
		if (line.facts.bye || line.facts.kickoff === null || sitsOut(line)) continue;
		const proj = printedProj(line);
		if (kickedOffAt(line, read.moment.now)) {
			// In play, the rest of his Proj (roster_projection.go inPlayAt): Lane 92's rule where his points
			// are read, else his Proj at its pace, the share of his 3 h 15 m game left (fix round 3). Final,
			// nothing.
			if (!read.moment.final(line) && proj !== null) sum += inPlayLeft(line, proj, read.moment.now);
			continue;
		}
		if (proj === null) return null;
		sum += proj;
	}
	return tenth(sum);
}

/** The roster's best lineup's Proj this week (roster_projection.go bestLineup): the lineup rule's fill
 * from every player who can play, one whose game has kicked off included, each starter's Proj as
 * printed, summed; null where no starter has one (week.go printedSum). */
export function bestLineupProj(
	roster: readonly PlayerLine[],
	slots: readonly LineupSlot['slot'][]
): number | null {
	const projected = weekStarters(roster, slots).flatMap((l) => {
		const p = printedProj(l);
		return p === null ? [] : [p];
	});
	return projected.length === 0 ? null : tenth(projected.reduce((sum, p) => sum + p, 0));
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

/** Each side's roster as FFPC's rosters page carries it (the member's opponent's as the Matchup benches
 * it, the rest from the recorded rosters), null for a team the page carries none for. */
function rosterReads(
	recorded: RecordedRosters,
	matchup: MatchupBox
): (rosterId: number) => readonly PlayerLine[] | null {
	const boxed = new Map(matchup.sides.map((s) => [s.roster_id, boxRoster(s)] as const));
	const players = new Map(recorded.matchups.map((m) => [m.roster_id, m.players] as const));
	return (rosterId) => {
		if (FFPC_ROSTERLESS.has(rosterId)) return null;
		const roster =
			boxed.get(rosterId) ??
			(players.get(rosterId) ?? []).flatMap((id) => recorded.lines.get(id) ?? []);
		return roster.length > 0 ? roster : null;
	};
}

interface FfpcWeek {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
	scoreboard: Scoreboard;
}

/** The scoreboard as FFPC's read holds it at the moment (Lane 125, B104; Lane 127, B105): every side's
 * starters unlisted but the member's (ffpcsnap.go ownLineupOnly), each read by the schedule, its
 * roster's games or the week's where the page carries no roster (Lane 124, B102), its Proj our best
 * lineup from the roster; a game final only once both sides are. */
function ffpcScoreboard(
	week: FfpcWeek,
	ffpc: Pick<FfpcWeek, 'lineup' | 'matchup'>,
	moment: Pick<Moment, 'now' | 'final'>,
	recorded: RecordedRosters
): { scoreboard: Scoreboard; stateOf: (rosterId: number) => GameState } {
	const me = week.sync.me;
	const listed = ffpc.matchup.sides.find((s) => s.roster_id === me)?.starters.map((st) => st.line);
	const template = listed?.[0];
	if (template === undefined)
		throw new Error('the FFPC stand-in needs the member starting a player');
	const rosters = rosterReads(recorded, ffpc.matchup);
	const week6 = weekLines(template);
	// Each side's schedule lines by the API's rule (scheduleRead): its roster's, else the week's.
	const reads = (rosterId: number): readonly PlayerLine[] => rosters(rosterId) ?? week6;
	const slots = [...ffpc.lineup.slots.map((s) => s.slot), ...ffpc.lineup.empty_slots];
	const stateOf = (rosterId: number): GameState => scheduleStateOf(reads(rosterId), moment);
	const gameOf = (g: Scoreboard['games'][number]): Scoreboard['games'][number] => {
		const mine = g.sides.some((s) => s.roster_id === me);
		const unlisted = g.sides.filter((s) => s.roster_id !== me).map((s) => reads(s.roster_id));
		const head = listedGameOf(mine ? (listed ?? []) : [], unlisted, moment);
		const started = head.state !== 'upcoming';
		return {
			...g,
			...head,
			// No starter listed on either side: nothing to count (scoreboard.go toPlay over none).
			to_play: mine ? g.to_play : null,
			sides: g.sides.map((s) =>
				s.roster_id === me
					? s
					: hiddenSide(s, stateOf(s.roster_id), {
							roster: rosters(s.roster_id),
							slots,
							moment,
							started
						})
			)
		};
	};
	const scoreboard: Scoreboard = {
		...week.scoreboard,
		projection_scoring: ffpc.lineup.projection_scoring,
		games: week.scoreboard.games.map(gameOf)
	};
	return { scoreboard, stateOf };
}

/** The FFPC stand-in before its Sunday (Lane 127, B105): the recorded week's Saturday answers as FFPC's,
 * the scoreboard as FFPC's read holds it at the clock (ffpcScoreboard), from Thursday night through
 * Sunday morning, the Matchup's opponent listing no starters as on the board (unlistedMatchup, Lane 137). */
export function ffpcBeforeSunday(
	week: FfpcWeek,
	moment: Pick<Moment, 'now' | 'final'>,
	recorded: RecordedRosters
): FfpcWeek {
	const ffpc = ffpcStandIn(week);
	const { scoreboard, stateOf } = ffpcScoreboard(week, ffpc, moment, recorded);
	// The Matchup's opponent unlisted as FFPC's read holds him from Thursday night on too (Lane 137,
	// B107 and its addendum): his Proj the board's best lineup, both teams' points the board's, as one
	// read holds them.
	return {
		...ffpc,
		sync: boardPoints(ffpc.sync, scoreboard),
		matchup: unlistedMatchup(ffpc.matchup, week.sync.me, scoreboard, stateOf),
		scoreboard
	};
}

/** The read's matchup with each team's points as the board holds them at the clock (one FFPC read
 * gives both), so the Matchup's Pts are the home bug's (Lane 137, the B107 addendum). */
function boardPoints(sync: LeagueSync, scoreboard: Scoreboard): LeagueSync {
	const points = new Map(
		scoreboard.games.flatMap((g) => g.sides).map((s) => [s.roster_id, s.points] as const)
	);
	const at = <S extends { roster_id: number; points: number }>(side: S): S => ({
		...side,
		points: points.get(side.roster_id) ?? side.points
	});
	const m = sync.matchup;
	if (m === null) return sync;
	return { ...sync, matchup: { ...m, mine: at(m.mine), opponent: m.opponent && at(m.opponent) } };
}

/** The Matchup as FFPC's read holds it (ffpcsnap.go ownLineupOnly): the opponent lists no starters, his
 * bench every player FFPC's rosters page carries for him, his Proj, Proj final and their flags the
 * board's by one rule (matchup.go, Lane 127 fix round 1; Lane 137 B107), his state the schedule's. No
 * standing or Decided: the API needs both sides' starters for them. */
function unlistedMatchup(
	matchup: MatchupBox,
	me: number,
	scoreboard: Scoreboard,
	stateOf: (rosterId: number) => GameState
): MatchupBox {
	const boardSide = (rosterId: number): ScoreboardSide | undefined =>
		scoreboard.games.flatMap((g) => g.sides).find((s) => s.roster_id === rosterId);
	return {
		...matchup,
		// The API says no standing with a side listing no starters (standing.go standingOf).
		standing: null,
		decided: null,
		sides: matchup.sides.map((s) => {
			if (s.roster_id === me) return s;
			const board = boardSide(s.roster_id);
			const best = board?.projection_best_lineup === true;
			return {
				...s,
				starters: [],
				bench: boxRoster(s),
				// No starter of his to count (matchup.go toPlay over none).
				to_play: null,
				projected_final: board?.projected_final ?? null,
				...(board?.projected_final_paced === true ? { projected_final_paced: true } : {}),
				...(best ? { projection: board.projection, projection_best_lineup: true } : {}),
				...(best && board.best_lineup_skipped === true ? { best_lineup_skipped: true } : {}),
				schedule_state: stateOf(s.roster_id)
			};
		})
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
	week: FfpcWeek,
	moment: Pick<Moment, 'now' | 'final'>,
	recorded: RecordedRosters
): FfpcWeek {
	const ffpc = ffpcStandIn(week);
	const me = week.sync.me;
	const { scoreboard, stateOf } = ffpcScoreboard(week, ffpc, moment, recorded);
	const done = ffpc.lineup.week_done_state ?? null;
	return {
		...ffpc,
		lineup: {
			...ffpc.lineup,
			week_done_state: done === null ? null : weekDoneState(scoreboard, me, done === 'final')
		},
		matchup: unlistedMatchup(ffpc.matchup, me, scoreboard, stateOf),
		scoreboard
	};
}
