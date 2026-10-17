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
	slotWord,
	type BoxRow,
	type BoxStarter
} from './box.ts';

/** A side's rows and totals as its box draws them. */
export interface SideBox {
	starters: BoxStarter[];
	bench: BoxRow[];
	totals: { proj: number | null; pts: number | null };
	/** Every line the side's rows came from, for the screen's facts read. */
	lines: PlayerLine[];
}

/** A side's box: the API's rows when it answered for the side, else the league read's starters with
 * their points so far when the host gives them. pts is the side's total as the screen shows it. */
export function sideBox(
	side: MatchupSide,
	box: MatchupBoxSide | null,
	scored: boolean,
	pts: number | null,
	zone: string = memberZone()
): SideBox {
	if (box !== null) {
		const starters = box.starters.map((s) => ({ row: boxRow(s.line, slotWord(s.slot), zone) }));
		return {
			starters,
			bench: box.bench.map((line) => boxRow(line, '', zone)),
			totals: { proj: projTotal(starters.map((s) => s.row)), pts },
			lines: [...box.starters.map((s) => s.line), ...box.bench]
		};
	}
	const starters = side.starters.map((s) => ({
		row: hostRow(s.player, positionWord(s.player.position), scored ? s.points : null)
	}));
	return { starters, bench: [], totals: { proj: null, pts }, lines: [] };
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
