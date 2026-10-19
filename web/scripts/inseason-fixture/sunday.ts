// The week at a moment past its first kickoff, a stand-in (Lane 66i, Lane 79, Lane 85): a player whose
// game has kicked off has scored a share of his projection (SCORED_SHARE, made up so the played states
// and the platforms' points by player can be drawn; lane-79-shots/README.md says so). Two moments:
//   - the Sunday afternoon (sundayOf): the noon games in their fourth quarter, the early ones final,
//     the late games still to kick off; the stand-in API answers by it when the browser asks for the
//     Sunday (the fixture_week cookie, on FIXTURE_SUNDAY_CLOCK), and league.ts builds
//     scoreboard-live.json by the same rules;
//   - after the Sunday (afterSundayOf, on the Monday and Tuesday clocks): each game final by the API's
//     rule at the fixture's clock (game-state.ts stateAt), the Lineup advised as the engine would with
//     every kicked-off player locked, the scoreboard restated, and the week in the books once every
//     starter's game is final.
import type { LeagueSync, MatchupSide } from '../../src/lib/league/api.ts';
import type {
	LineupAdvice,
	MatchupBox,
	PlayerLine,
	Scoreboard
} from '../../src/lib/league/inseason/api.ts';
import { advise } from './advise.ts';
import { FIXTURE_SUNDAY_READ } from './clock.ts';
import { stateAt } from './game-state.ts';
import {
	kickedOffAt,
	scoreboardAt,
	SCORED_SHARE,
	type Recorded as RecordedWeek
} from './scoreboard-at.ts';
import { roundTenth } from './tenths.ts';

export { SCORED_SHARE };
/** The Sunday stand-in's read: 1:52 pm Central, the noon games in their fourth quarter. */
export const SUNDAY = FIXTURE_SUNDAY_READ;
/** On the Sunday stand-in the early games are over: every kickoff before noon Central is final. */
export const SUNDAY_FINAL_BY = Date.parse('2026-10-18T17:00:00.000Z') - 1;

/** A game final on the Sunday stand-in: played, or kicked off before noon Central. */
export function sundayFinal(line: PlayerLine): boolean {
	const at =
		line.facts.kickoff === null ? Number.POSITIVE_INFINITY : Date.parse(line.facts.kickoff);
	return line.facts.played || at <= SUNDAY_FINAL_BY;
}

/** A moment of the week: its instant and its rule for a final. */
interface Moment {
	now: number;
	final: (line: PlayerLine) => boolean;
}

/** A player's points so far, as the platform sends them and the API rounds them: the scored share of
 * his projection once he has kicked off, 0 before. */
function pointsSoFar(line: PlayerLine, moment: Moment): number {
	return kickedOffAt(line, moment.now) ? roundTenth((line.week_projection ?? 0) * SCORED_SHARE) : 0;
}

/** A line at the moment: its game final by the moment's rule, and his points so far once he has
 * kicked off, bench or starter (the API's points_this_week, Lane 79 fix 3). */
function lineAt(line: PlayerLine, moment: Moment): PlayerLine {
	return {
		...line,
		facts: {
			...line.facts,
			played: moment.final(line),
			points_this_week: kickedOffAt(line, moment.now) ? pointsSoFar(line, moment) : null
		}
	};
}

/** The API's sentence once every starter's game is final (inseason words.go WeekDoneWords), null
 * while any is still to come or under way. */
function weekDone(lineup: LineupAdvice, moment: Moment): string | null {
	const games = lineup.slots.filter(({ ours }) => !ours.facts.bye && ours.facts.kickoff !== null);
	if (games.length === 0 || !games.every(({ ours }) => moment.final(ours))) return null;
	return `Every starter's game is final, so week ${String(lineup.week)} is in the books.`;
}

/** The Lineup at the moment: the roster advised again as the engine would then (advise.ts, engine.go
 * Lineup), every kicked-off player locked where the host has him, then each line with his points so
 * far. */
function lineupAt(lineup: LineupAdvice, moment: Moment): LineupAdvice {
	const advised = advise(lineup, (line) => kickedOffAt(line, moment.now));
	return {
		...advised,
		slots: advised.slots.map((s) => ({
			...s,
			ours: lineAt(s.ours, moment),
			host: s.host === null ? null : lineAt(s.host, moment)
		})),
		bench: advised.bench.map((l) => lineAt(l, moment)),
		week_done: weekDone(advised, moment)
	};
}

/** The recorded answers a league's week is drawn from. */
export interface Recorded {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
	scoreboardLive: Scoreboard;
}

/** The answers at a moment that the scoreboard's totals stand behind. */
export interface Week {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
}

/** A league at a moment, its platform's own answers given (an ESPN league's carry team_total): the
 * box score's and the Lineup's players with their points by player, each side's total the
 * scoreboard's, and its Lineup advised as the engine would then. Yahoo's stand-in (yahoo.ts) strips
 * the players' points from it. */
function weekOf(
	{ sync, lineup, matchup }: Omit<Recorded, 'scoreboardLive'>,
	scoreboard: Scoreboard,
	moment: Moment
): Week {
	const total = new Map(
		scoreboard.games.flatMap((g) => g.sides.map((s) => [s.roster_id, s.points] as const))
	);
	const lines = new Map(
		matchup.sides.flatMap((s) => s.starters.map((st) => [st.line.player.host_id, st.line] as const))
	);
	const side = (s: MatchupSide): MatchupSide => ({
		...s,
		points: total.get(s.roster_id) ?? s.points,
		starters: s.starters.map((st) => {
			const line = lines.get(st.player.host_id);
			return { ...st, points: line === undefined ? null : pointsSoFar(line, moment) };
		})
	});
	const week = sync.matchup;
	return {
		sync: {
			...sync,
			matchup:
				week === null
					? null
					: { ...week, mine: side(week.mine), opponent: week.opponent && side(week.opponent) }
		},
		lineup: {
			...lineupAt(lineup, moment),
			player_points: true,
			team_points: total.get(sync.me) ?? null
		},
		matchup: {
			...matchup,
			sides: matchup.sides.map((s) => ({
				...s,
				starters: s.starters.map((st) => ({ ...st, line: lineAt(st.line, moment) })),
				bench: s.bench.map((l) => lineAt(l, moment))
			}))
		}
	};
}

const sundayMoment: Moment = { now: Date.parse(SUNDAY), final: sundayFinal };

/** A league on the Sunday afternoon, its totals the Sunday's scoreboard (scoreboard-live.json). */
export function sundayOf(recorded: Recorded): Week {
	return weekOf(recorded, recorded.scoreboardLive, sundayMoment);
}

/** A league after its Sunday, at the fixture's clock `now`: every game final by the API's rule then
 * (stateAt), its scoreboard restated from the recorded week at that clock. */
export function afterSundayOf(
	recorded: Omit<Recorded, 'scoreboardLive'>,
	week: RecordedWeek,
	now: number,
	readAt: string
): Week & { scoreboard: Scoreboard } {
	const moment: Moment = { now, final: (line) => stateAt(line.facts, now) === 'final' };
	const scoreboard = scoreboardAt(week, { ...moment, scored: true }, readAt);
	return { ...weekOf(recorded, scoreboard, moment), scoreboard };
}
