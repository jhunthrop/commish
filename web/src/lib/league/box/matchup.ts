/** The Matchup screen's box score (Lane 66d): each side's rows from the API's box answer, or from the
 * league's read alone when there is none, its totals, and the score bug's middle (the next kickoff).
 * Pure functions, tested in matchup.test.ts. */
import { memberZone, weekdayTime } from '#lib/format/clock.ts';
import { gameHead, KICKOFF, linesRead } from './kickoff.ts';
import type { MatchupSide } from '../api.ts';
import type { MatchupBox, MatchupBoxSide, PlayerLine } from '../inseason/api.ts';
import {
	BOX,
	boxNumber,
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
	/** The game has kicked off (matchupStarted): the Team row's Pts are its big figure. */
	started: boolean;
}

/** A side's figures as its score bug prints them. */
export interface BugTotals {
	pts: number | null;
	proj: number | null;
	final: number | null;
	/** Where the side's starters stand while the game is under way (the API's to_play), else empty. */
	toPlay: string;
}

/** A matchup side's two figures (Lane 92, B22): before the first kickoff its Proj big and nothing
 * under; from it its Pts big with "Proj final" under, "--" where the API gives none. */
export function bugFigures(
	s: Pick<BugTotals, 'pts' | 'proj' | 'final'>,
	started: boolean
): { big: string; bigLabel: string; small: string } {
	if (!started) return { big: boxNumber(s.proj), bigLabel: BOX.proj, small: '' };
	return {
		big: boxNumber(s.pts),
		bigLabel: BOX.pts,
		small: `${BOX.projFinal} ${boxNumber(s.final)}`
	};
}

/** Whether any starter's game has kicked off at the page's clock, by the one rule (kickoff.ts). */
export function matchupStarted(lines: readonly PlayerLine[], now: number): boolean {
	const games = lines.flatMap(({ facts }) => (facts.bye || facts.kickoff === null ? [] : [facts]));
	return games.length > 0 && gameHead(linesRead(games, now), now).state !== 'upcoming';
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
				final: box.projected_final ?? null,
				live: read.started,
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
		totals: {
			proj: null,
			pts: sideScore(rows, side, read.hostTotal),
			final: null,
			live: read.started,
			note: null
		},
		lines: [],
		byPlayer: side.player_points,
		teamTotal: side.team_total
	};
}

/** The score bug's middle once the API says the game is decided (MatchupBox.decided, Lane 99 B31):
 * "Decided" in place of the state word while the game plays, the kickoff's words left out; as it was
 * before kickoff, once final, or from an answer without it. */
export function decidedHead(
	kickoff: { head: string; words: string } | null,
	decided: boolean,
	started: boolean
): { head: string; words: string } | null {
	if (kickoff === null || !decided || !started || kickoff.head === KICKOFF.final) return kickoff;
	return { head: KICKOFF.decided, words: '' };
}

/** The line under the bug's two scores (MatchupBox.standing, Lane 99 B31): the API's, from the first
 * kickoff at the page's clock; null before it or from an answer without one. */
export function standingLine(
	box: Pick<MatchupBox, 'standing'> | null,
	started: boolean
): string | null {
	return started ? (box?.standing ?? null) : null;
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
	// Each starter's game by the one rule at the page's clock, gathered once (kickoff.ts linesRead).
	const head = gameHead(
		linesRead(
			games.map((g) => g.facts),
			now
		),
		now
	);
	if (head.state === 'final') return { head: KICKOFF.final, words: '' };
	const next = games.find((g) => g.at === head.next);
	if (next === undefined)
		return head.state === 'kicked_off' ? { head: KICKOFF.kickedOff, words: '' } : null;
	const side = next.facts.home === false ? 'at' : 'vs';
	return {
		head: head.state === 'kicked_off' ? KICKOFF.next : KICKOFF.first,
		words: `${weekdayTime(next.at, zone)}, ${next.club} ${side} ${next.facts.opponent ?? ''}`
	};
}
