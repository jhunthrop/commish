/** The Matchup screen's box score (Lane 66d): each side's rows from the API's box answer, or from the
 * league's read alone when there is none, its totals, and the score bug's middle (the next kickoff).
 * Pure functions, tested in matchup.test.ts. */
import { memberZone, weekdayTime } from '#lib/format/clock.ts';
import { gameStateOf, toBePlayed } from '#lib/format/game-facts.ts';
import { gameHead, KICKOFF } from './kickoff.ts';
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
	/** The platform sends the side's own total: the bug and the Totals row print it. */
	teamTotal: boolean;
}

/** What a side's box reads besides its rows: the host's total for it as the screen shows it, whether
 * the week's projection has landed, the week, and the instant the box is drawn at, in ms. */
export interface SideRead {
	hostTotal: number | null;
	landed: boolean;
	week: number;
	now: number;
}

/** A side's score, the one figure the score bug and the Matchup's Totals row both print (ruling (a),
 * Lane 79): the platform's own total where it sends one or gives no player's points, else the printed
 * rows added (Sleeper, MFL). */
export function sideScore(
	rows: readonly Pick<BoxRow, 'pts'>[],
	side: { player_points: boolean; team_total: boolean },
	hostTotal: number | null
): number | null {
	return totalsPts(rows, side.player_points && !side.team_total, hostTotal);
}

/** A side's box: the API's rows when it answered for the side, else the league read's starters with
 * their points so far when the host gives them. Totals' Pts is the side's score (sideScore), the bug's
 * figure too. */
export function sideBox(
	side: MatchupSide,
	box: MatchupBoxSide | null,
	read: SideRead,
	zone: string = memberZone()
): SideBox {
	if (box !== null) {
		const starters = box.starters.map((s) => ({
			row: boxRow(s.line, slotWord(s.slot), zone, true, read.now)
		}));
		const rows = starters.map((s) => s.row);
		return {
			starters,
			bench: box.bench.map((line) => boxRow(line, '', zone, true, read.now)),
			totals: {
				proj: projTotal(rows),
				pts: sideScore(rows, box, read.hostTotal),
				note: totalsNote(rows, read.landed, read.week)
			},
			lines: [...box.starters.map((s) => s.line), ...box.bench],
			byPlayer: box.player_points,
			teamTotal: box.team_total
		};
	}
	const starters = side.starters.map((s) => ({
		row: hostRow(s.player, positionWord(s.player.position), side.player_points ? s.points : null)
	}));
	const rows = starters.map((s) => s.row);
	return {
		starters,
		bench: [],
		totals: { proj: null, pts: sideScore(rows, side, read.hostTotal), note: null },
		lines: [],
		byPlayer: side.player_points,
		teamTotal: side.team_total
	};
}

/** The score bug's middle by the one rule the League page's bugs read (kickoff.ts): "First kickoff"
 * before any of the matchup's starters' games, "Next kickoff" once one has started with another still
 * to come, then "Kicked off" and "Final" by the API's states; a kickoff before the page's clock is never
 * next. Null when no starter has a game. */
export function nextKickoff(
	lines: readonly PlayerLine[],
	now: number,
	zone: string = memberZone()
): { head: string; words: string } | null {
	const games = lines.flatMap(({ facts, player }) =>
		facts.bye || facts.kickoff === null || facts.opponent === null
			? []
			: [{ at: facts.kickoff, club: player.team, facts }]
	);
	if (games.length === 0) return null;
	const ahead = games
		.filter((g) => toBePlayed(g.facts, now))
		.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	const final = games.every(({ facts }) => {
		const state = gameStateOf(facts);
		return state === 'final' || (state === null && facts.played);
	});
	const head = gameHead(
		{
			state: final ? 'final' : ahead.length < games.length ? 'playing' : 'upcoming',
			next: ahead[0]?.at ?? null
		},
		now
	);
	if (head.state === 'final') return { head: KICKOFF.final, words: '' };
	const next = ahead.find((g) => g.at === head.next);
	if (next === undefined)
		return head.state === 'kicked_off' ? { head: KICKOFF.kickedOff, words: '' } : null;
	const side = next.facts.home === false ? 'at' : 'vs';
	return {
		head: head.state === 'kicked_off' ? KICKOFF.next : KICKOFF.first,
		words: `${weekdayTime(next.at, zone)}, ${next.club} ${side} ${next.facts.opponent ?? ''}`
	};
}
