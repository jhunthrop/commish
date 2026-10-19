// The week on its Sunday afternoon, a stand-in (Lane 66i, Lane 79): the noon games in their fourth
// quarter, the early ones final, the late games still to kick off. A player whose game has kicked off
// has scored a share of his projection (SCORED_SHARE, made up so the played states and ESPN's points
// by player can be drawn; lane-79-shots/README.md says so). league.ts builds scoreboard-live.json by
// these rules; the stand-in API answers an ESPN league's Matchup, Lineup and read by them when the
// browser asks for the Sunday (the fixture_week cookie, on FIXTURE_SUNDAY_CLOCK).
import type { LeagueSync, MatchupSide } from '../../src/lib/league/api.ts';
import type {
	LineupAdvice,
	MatchupBox,
	PlayerLine,
	Scoreboard
} from '../../src/lib/league/inseason/api.ts';
import { advise } from './advise.ts';
import { FIXTURE_SUNDAY_READ } from './clock.ts';
import { roundTenth } from './tenths.ts';

/** The share of a kicked-off player's projection the Sunday stand-in counts as scored. */
export const SCORED_SHARE = 0.85;
/** The Sunday stand-in's read: 1:52 pm Central, the noon games in their fourth quarter. */
export const SUNDAY = FIXTURE_SUNDAY_READ;
/** On the Sunday stand-in the early games are over: every kickoff before noon Central is final. */
export const SUNDAY_FINAL_BY = Date.parse('2026-10-18T17:00:00.000Z') - 1;

const sundayAt = Date.parse(SUNDAY);

/** His game has kicked off by the Sunday read: ESPN locks him (lineupLocked). */
function kickedOff(line: PlayerLine): boolean {
	const { bye, kickoff } = line.facts;
	return !bye && kickoff !== null && Date.parse(kickoff) <= sundayAt;
}

/** A player's points so far on the Sunday, as ESPN sends them and the API rounds them: the scored
 * share of his projection once he has kicked off, 0 before. */
function pointsSoFar(line: PlayerLine): number {
	return kickedOff(line) ? roundTenth((line.week_projection ?? 0) * SCORED_SHARE) : 0;
}

/** A line on the Sunday: its game final when it kicked off before noon Central, and his points so
 * far once he has kicked off, bench or starter (the API's points_this_week, Lane 79 fix 3). */
function sundayLine(line: PlayerLine): PlayerLine {
	const at =
		line.facts.kickoff === null ? Number.POSITIVE_INFINITY : Date.parse(line.facts.kickoff);
	return {
		...line,
		facts: {
			...line.facts,
			played: line.facts.played || at <= SUNDAY_FINAL_BY,
			points_this_week: kickedOff(line) ? pointsSoFar(line) : null
		}
	};
}

/** The Lineup on the Sunday: the roster advised again as the engine would on that Sunday (advise.ts,
 * engine.go Lineup), every kicked-off player locked where the host has him, then each line with his
 * points so far. */
function sundayLineup(lineup: LineupAdvice): LineupAdvice {
	const advised = advise(lineup, kickedOff);
	return {
		...advised,
		slots: advised.slots.map((s) => ({
			...s,
			ours: sundayLine(s.ours),
			host: s.host === null ? null : sundayLine(s.host)
		})),
		bench: advised.bench.map(sundayLine)
	};
}

/** The recorded answers an ESPN league's Sunday is drawn from. */
export interface Recorded {
	sync: LeagueSync;
	lineup: LineupAdvice;
	matchup: MatchupBox;
	scoreboardLive: Scoreboard;
}

/** A league on the Sunday, its platform's own answers given (an ESPN league's carry team_total):
 * the box score's and the Lineup's players with their points by player, each side's total the
 * platform's (scoreboard-live's), and its Lineup advised as the engine would on that Sunday. Yahoo's
 * stand-in (yahoo.ts) strips the players' points from it. */
export function sundayOf({ sync, lineup, matchup, scoreboardLive }: Recorded): {
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
	const side = (s: MatchupSide): MatchupSide => ({
		...s,
		points: total.get(s.roster_id) ?? s.points,
		starters: s.starters.map((st) => {
			const line = lines.get(st.player.host_id);
			return { ...st, points: line === undefined ? null : pointsSoFar(line) };
		})
	});
	const week = sync.matchup;
	const box = matchup;
	return {
		sync: {
			...sync,
			matchup:
				week === null
					? null
					: { ...week, mine: side(week.mine), opponent: week.opponent && side(week.opponent) }
		},
		lineup: {
			...sundayLineup(lineup),
			player_points: true,
			team_points: total.get(sync.me) ?? null
		},
		matchup: {
			...box,
			sides: box.sides.map((s) => ({
				...s,
				starters: s.starters.map((st) => ({ ...st, line: sundayLine(st.line) })),
				bench: s.bench.map(sundayLine)
			}))
		}
	};
}
