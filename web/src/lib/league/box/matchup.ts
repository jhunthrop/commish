/** The Matchup screen's box score (Lane 66d): each side's rows from the API's box answer, or from the
 * league's read alone when there is none, its totals, and the score bug's middle (the next kickoff).
 * Pure functions, tested in matchup.test.ts. */
import { memberZone, weekdayTime } from '#lib/format/clock.ts';
import { toBePlayed } from '#lib/format/game-facts.ts';
import type { MatchupSide } from '../api.ts';
import type { MatchupBoxSide, PlayerLine } from '../inseason/api.ts';
import {
	boxRow,
	hostRow,
	positionWord,
	projTotal,
	totalsNote,
	totalsPts,
	slotWord,
	type BoxRow,
	type BoxStarter,
	type BoxTotals
} from './box.ts';

/** A side's rows and totals as its box draws them. */
export interface SideBox {
	starters: BoxStarter[];
	bench: BoxRow[];
	totals: BoxTotals;
	/** Every line the side's rows came from, for the screen's facts read. */
	lines: PlayerLine[];
	/** The host gives each player's points for the side. */
	byPlayer: boolean;
	/** The side's score as the bug prints it: the platform's own total, never the rows' sum (Lane 79). */
	score: number | null;
}

/** What a side's box reads besides its rows: whether its starters have any points (the league read's
 * own sign, for a side without the API's rows), the host's total for it as the screen shows it,
 * whether the week's projection has landed, and the week. */
export interface SideRead {
	scored: boolean;
	hostTotal: number | null;
	landed: boolean;
	week: number;
}

/** A side's box: the API's rows when it answered for the side, else the league read's starters with
 * their points so far when the host gives them. Totals' Pts follow totalsPts, the one rule both
 * screens share; the bug's score is the platform's total. */
export function sideBox(
	side: MatchupSide,
	box: MatchupBoxSide | null,
	read: SideRead,
	zone: string = memberZone()
): SideBox {
	if (box !== null) {
		const starters = box.starters.map((s) => ({ row: boxRow(s.line, slotWord(s.slot), zone) }));
		const rows = starters.map((s) => s.row);
		return {
			starters,
			bench: box.bench.map((line) => boxRow(line, '', zone)),
			totals: {
				proj: projTotal(rows),
				pts: totalsPts(rows, box.player_points, read.hostTotal),
				note: totalsNote(rows, read.landed, read.week)
			},
			lines: [...box.starters.map((s) => s.line), ...box.bench],
			byPlayer: box.player_points,
			score: read.hostTotal
		};
	}
	const starters = side.starters.map((s) => ({
		row: hostRow(s.player, positionWord(s.player.position), read.scored ? s.points : null)
	}));
	const rows = starters.map((s) => s.row);
	return {
		starters,
		bench: [],
		totals: { proj: null, pts: totalsPts(rows, read.scored, read.hostTotal), note: null },
		lines: [],
		byPlayer: read.scored,
		score: read.hostTotal
	};
}

/** The score bug's middle: the next kickoff among the matchup's starters, "First kickoff" before any
 * has started; null once every game has. */
export function nextKickoff(
	lines: readonly PlayerLine[],
	now: number,
	zone: string = memberZone()
): { head: string; words: string } | null {
	const games = lines.flatMap(({ facts, player }) =>
		facts.bye || facts.kickoff === null || facts.opponent === null
			? []
			: [{ at: facts.kickoff, played: facts.played, club: player.team, facts }]
	);
	const ahead = games
		.filter((g) => toBePlayed({ played: g.played, kickoff: g.at }, now))
		.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	const next = ahead[0];
	if (next === undefined) return null;
	const started = ahead.length < games.length;
	const side = next.facts.home === false ? 'at' : 'vs';
	return {
		head: started ? 'Next kickoff' : 'First kickoff',
		words: `${weekdayTime(next.at, zone)}, ${next.club} ${side} ${next.facts.opponent ?? ''}`
	};
}
