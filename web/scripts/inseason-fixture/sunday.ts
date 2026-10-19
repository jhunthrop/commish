// The week on its Sunday afternoon, a stand-in (Lane 66i, Lane 79): the noon games final, the late
// games still to kick off. A kicked-off starter has scored a share of his projection, so the board's
// played states and ESPN's points by player can be drawn. league.ts builds scoreboard-live.json by
// these rules; the stand-in API answers an ESPN league's Matchup, Lineup and read by them when the
// browser asks for the Sunday (the fixture_week cookie, on FIXTURE_SUNDAY_CLOCK).
import type { LeagueSync, MatchupSide } from '../../src/lib/league/api.ts';
import type {
	LineupAdvice,
	MatchupBox,
	PlayerLine,
	Scoreboard
} from '../../src/lib/league/inseason/api.ts';
import { FIXTURE_SUNDAY_READ } from './clock.ts';
import { roundTenth } from './tenths.ts';

/** The share of a kicked-off starter's projection the Sunday stand-in counts as scored. */
export const SCORED_SHARE = 0.85;
/** The Sunday stand-in's read: 1:52 pm Central, the noon games in their fourth quarter. */
export const SUNDAY = FIXTURE_SUNDAY_READ;
/** On the Sunday stand-in the early games are over: every kickoff before noon Central is final. */
export const SUNDAY_FINAL_BY = Date.parse('2026-10-18T17:00:00.000Z') - 1;

const sundayAt = Date.parse(SUNDAY);

/** His game has kicked off by the Sunday read. */
function kickedOff(line: PlayerLine): boolean {
	const { bye, kickoff } = line.facts;
	return !bye && kickoff !== null && Date.parse(kickoff) <= sundayAt;
}

/** A starter's points so far on the Sunday, as ESPN sends them and the API rounds them: the scored
 * share of his projection once he has kicked off, 0 before. */
function pointsSoFar(line: PlayerLine): number {
	return kickedOff(line) ? roundTenth((line.week_projection ?? 0) * SCORED_SHARE) : 0;
}

/** A line on the Sunday: its game final when it kicked off before noon Central, and a starter's
 * points so far once he has kicked off (the API's points_this_week, none for the bench). */
function sundayLine(line: PlayerLine, starts: boolean): PlayerLine {
	const at =
		line.facts.kickoff === null ? Number.POSITIVE_INFINITY : Date.parse(line.facts.kickoff);
	return {
		...line,
		facts: {
			...line.facts,
			played: line.facts.played || at <= SUNDAY_FINAL_BY,
			points_this_week: starts && kickedOff(line) ? pointsSoFar(line) : null
		}
	};
}

/** The recorded answers an ESPN league's Sunday is drawn from. */
export interface Recorded {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
	scoreboardLive: Scoreboard;
}

/** An ESPN league on the Sunday: the box score's and the Lineup's starters with ESPN's points by
 * player, and each side's total ESPN's own (scoreboard-live's), never the rows' sum. */
export function espnSunday({ sync, lineup, matchup, scoreboardLive }: Recorded): {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
} {
	const total = new Map(
		scoreboardLive.games.flatMap((g) => g.sides.map((s) => [s.roster_id, s.points] as const))
	);
	const lines = new Map(
		matchup.sides.flatMap((s) => s.starters.map((st) => [st.line.player.host_id, st.line] as const))
	);
	const starting = new Set(
		lineup.slots.flatMap((s) => (s.host === null ? [] : [s.host.player.host_id]))
	);
	const inLineup = (line: PlayerLine): PlayerLine =>
		sundayLine(line, starting.has(line.player.host_id));
	const side = (s: MatchupSide): MatchupSide => ({
		...s,
		points: total.get(s.roster_id) ?? s.points,
		starters: s.starters.map((st) => {
			const line = lines.get(st.player.host_id);
			return { ...st, points: line === undefined ? 0 : pointsSoFar(line) };
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
			...lineup,
			player_points: true,
			team_points: total.get(sync.me) ?? null,
			slots: lineup.slots.map((s) => ({
				...s,
				ours: inLineup(s.ours),
				host: s.host === null ? null : inLineup(s.host)
			})),
			bench: lineup.bench.map(inLineup)
		},
		matchup: {
			...matchup,
			sides: matchup.sides.map((s) => ({
				...s,
				player_points: true,
				starters: s.starters.map((st) => ({ ...st, line: sundayLine(st.line, true) })),
				bench: s.bench.map((line) => sundayLine(line, false))
			}))
		}
	};
}
