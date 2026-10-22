/** The Matchup screen's box score (Lane 66d): each side's rows from the API's box answer, or from the
 * league's read alone when there is none, its totals, and the score bug's middle (the next kickoff).
 * Pure functions, tested in matchup.test.ts. */
import { memberZone, weekdayTime } from '#lib/format/clock.ts';
import { gameHead, KICKOFF, linesRead, type GameRead } from './kickoff.ts';
import { NONE_UNLISTED, type UnlistedDrawn } from './basis.ts';
import type { MatchupSide } from '../api.ts';
import type { GameState, MatchupBox, MatchupBoxSide, PlayerLine } from '../inseason/api.ts';
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
	teamSmallFigure,
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
	/** The bug's head is Final by the lines the screen holds (matchupFinal): a side with no box, whose
	 * starters no line shows, reads Final under it (Lane 121 fix round 1). */
	headFinal?: boolean;
}

/** A box side listing no starters (FFPC's opponent view) is Final by its own state, the schedule's
 * (the API's schedule_state, Lane 124 B102); an answer without it follows the bug's head (Lane 121). */
function unlistedFinal(box: Pick<MatchupBoxSide, 'schedule_state'>, read: SideRead): boolean {
	return box.schedule_state === undefined
		? read.headFinal === true
		: box.schedule_state === 'final';
}

/** A side's figures as its score bug prints them. */
export interface BugTotals {
	pts: number | null;
	proj: number | null;
	final: number | null;
	/** Every starter of the side's is final (BoxTotals.allFinal, Lane 121 B99). */
	allFinal: boolean;
	/** Where the side's starters stand while the game is under way (the API's to_play), else empty. */
	toPlay: string;
}

/** A matchup side's two figures (Lane 92, B22): before the first kickoff its Proj big and nothing
 * under; from it its Pts big with the Team row's small figure under (box.ts teamSmallFigure, one rule
 * for both): "Proj final", "--" where the API gives none, and "Final" with the total once every
 * starter is final (Lane 121, B99). */
export function bugFigures(
	s: Pick<BugTotals, 'pts' | 'proj' | 'final' | 'allFinal'>,
	started: boolean
): { big: string; bigLabel: string; small: string } {
	const small = teamSmallFigure({ ...s, live: started });
	if (small === null) return { big: boxNumber(s.proj), bigLabel: BOX.proj, small: '' };
	return {
		big: boxNumber(s.pts),
		bigLabel: BOX.pts,
		small: `${small.caption} ${boxNumber(small.figure)}`
	};
}

/** The states by the schedule of the box's sides the platform lists no starters for (the API's
 * schedule_state, Lane 124 B102: FFPC's opponent view), none from an answer without them. */
export function unlistedStates(box: Pick<MatchupBox, 'sides'> | null): GameState[] {
	return (box?.sides ?? []).flatMap((s) =>
		s.schedule_state === undefined ? [] : [s.schedule_state]
	);
}

/** The matchup's game as one read (Lane 124, B102): its starters' lines by the one rule (kickoff.ts
 * linesRead), never final while a side the platform lists no starters for is not final by the
 * schedule (unlisted); null when no starter has a game. */
export function matchupRead(
	lines: readonly PlayerLine[],
	now: number,
	unlisted: readonly GameState[] = []
): GameRead | null {
	const games = lines.flatMap(({ facts }) => (facts.bye || facts.kickoff === null ? [] : [facts]));
	if (games.length === 0) return null;
	const read = linesRead(games, now);
	const waiting = read.state === 'final' && unlisted.some((s) => s !== 'final');
	return waiting ? { ...read, state: 'playing' } : read;
}

/** Whether the matchup is final at the page's clock (matchupRead): the bug's Final head, every side
 * final by its own rule. */
export function matchupFinal(
	lines: readonly PlayerLine[],
	now: number,
	unlisted: readonly GameState[] = []
): boolean {
	return matchupRead(lines, now, unlisted)?.state === 'final';
}

/** Whether any starter's game has kicked off at the page's clock, by the one rule (kickoff.ts). */
export function matchupStarted(lines: readonly PlayerLine[], now: number): boolean {
	const read = matchupRead(lines, now);
	return read !== null && gameHead(read, now).state !== 'upcoming';
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

/** A box side's Proj: its starters' rows added, or for a side the platform lists no starters for whose
 * Proj is our best lineup from its roster (an FFPC opponent), the API's figure, the one the League
 * page's bug draws for him (Lane 137, B107); none from an answer without it. */
function sideProj(
	box: Pick<MatchupBoxSide, 'starters' | 'projection' | 'projection_best_lineup'>,
	rows: readonly BoxRow[]
): number | null {
	if (box.starters.length > 0 || box.projection_best_lineup !== true) return projTotal(rows);
	return box.projection ?? null;
}

/** What a box side the platform lists no starters for draws from our best lineup of its roster (an
 * FFPC opponent; basis.ts UnlistedDrawn): its Proj before kickoff (Lane 137, B107), its Proj final
 * while it plays (Lane 127 fix round 1), said once in the basis; with no roster read for it either, its
 * "--" under either (noRoster, Lane 141, B121); nothing once it is final, for a best lineup drawing
 * "--", or for a side listing starters. */
export function matchupUnlisted(
	box: Pick<
		MatchupBoxSide,
		'starters' | 'projection_best_lineup' | 'best_lineup_skipped' | 'projected_final_paced'
	> | null,
	totals: Pick<BoxTotals, 'proj' | 'final' | 'live' | 'allFinal'>
): UnlistedDrawn {
	if (box === null || box.starters.length > 0) return NONE_UNLISTED;
	// Once final the side draws its total, so neither figure is drawn (finalNonePart keys a "--" total).
	if (totals.live && totals.allFinal) return NONE_UNLISTED;
	const figure = totals.live ? totals.final : totals.proj;
	// No roster read for him either: his Proj or Proj final reads "--", said in its own sentence, as
	// the League page says it, never the starters' "No Proj final while..." (Lane 141, B121).
	if (box.projection_best_lineup !== true)
		return figure === null ? { ...NONE_UNLISTED, noRoster: true } : NONE_UNLISTED;
	if (figure === null) return NONE_UNLISTED;
	return {
		bestLineup: true,
		noRoster: false,
		paced: totals.live && box.projected_final_paced === true,
		skipped: box.best_lineup_skipped === true
	};
}

/** Whether a Team row under way draws its Proj final "--" that the starters' key explains (basis.ts
 * NO_PROJ_FINAL_PART): the member's, or an opponent's but one with no lineup or roster read, whose
 * "--" its own sentence says (matchupUnlisted noRoster, Lane 141, B121). */
export function matchupNoFinal(
	mine: Pick<BoxTotals, 'live' | 'final'> | null,
	theirs: Pick<BoxTotals, 'live' | 'final'> | null,
	theirsUnlisted: Pick<UnlistedDrawn, 'noRoster'>
): boolean {
	const missing = (s: Pick<BoxTotals, 'live' | 'final'> | null): boolean =>
		s !== null && s.live && s.final === null;
	return missing(mine) || (missing(theirs) && !theirsUnlisted.noRoster);
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
				proj: sideProj(box, rows),
				pts: sideScore(rows, box, read.hostTotal),
				final: box.projected_final ?? null,
				live: read.started,
				// A box with no starters (FFPC's opponent view) has no line to read: the side is Final by
				// the schedule (Lane 124, B102).
				allFinal:
					box.starters.length === 0
						? unlistedFinal(box, read)
						: linesRead(
								box.starters.map((s) => s.line.facts),
								read.now
							).state === 'final',
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
			// No line of the API's holds its starters' games: it follows the bug's head, so it never
			// reads Proj final under a Final head (fix round 1, HIGH-1).
			allFinal: read.headFinal === true,
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
	zone: string = memberZone(),
	unlisted: readonly GameState[] = []
): { head: string; words: string } | null {
	const games = lines.flatMap(({ facts, player }) =>
		facts.bye || facts.kickoff === null || facts.opponent === null
			? []
			: [{ at: facts.kickoff, club: player.team, facts }]
	);
	// Each starter's game by the one rule at the page's clock, gathered once (matchupRead), a side
	// listing no starters final by the schedule only (Lane 124, B102).
	const read = matchupRead(lines, now, unlisted);
	if (games.length === 0 || read === null) return null;
	const head = gameHead(read, now);
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
