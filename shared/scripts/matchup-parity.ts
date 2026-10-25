/** The Matchup screen's parity (Lane 183): what the web's Matchup (MatchupScreen.svelte at 390 over
 * MatchupPanel, MatchupBug, BoxTable, TeamFigures and BoxBasis) prints for the fixture league's week
 * at each fixture clock, in the fixture's zone, as JSON the apps' ports are held to: the title, the
 * score bug (each side's figures, the game's head and its words, the read beside a live score, the
 * API's standing), the notes, each team's box (every row's cells as the phone draws them, the Team
 * row, the bench, the sentence in place of starters a platform does not send) and the phone's basis.
 * The screen draws at the league read's instant and ages the read cell by the page's clock, as
 * MatchupScreen passes them. A second set reads each clock's league without the box answer (the API
 * refusing it), the read's starters alone; a third the gap sentences with no matchup; a fourth another
 * team's game (Lane 206), its box asked by roster, its head and score the scoreboard's (game.ts
 * otherGame), none of the member's words. Written by export-parity.ts beside the Lineup's. */
import {
	BOX,
	boxNumber,
	teamSmallFigure,
	type BoxRow,
	type BoxTotals
} from '../../web/src/lib/league/box/box.ts';
import { boxBasisParts, drawnText, NONE_UNLISTED } from '../../web/src/lib/league/box/basis.ts';
import { KICKOFF } from '../../web/src/lib/league/box/kickoff.ts';
import {
	allPlayWords,
	bugFigures,
	decidedHead,
	matchupFinal,
	matchupNoFinal,
	matchupStarted,
	MATCHUP,
	matchupUnlisted,
	nextKickoff,
	showsTotal,
	sideBox,
	standingLine,
	unlistedStates,
	yoursOnlyWords,
	type SideBox
} from '../../web/src/lib/league/box/matchup.ts';
import { readCell } from '../../web/src/lib/league/home/home.ts';
import type { LeagueSync, MatchupSide } from '../../web/src/lib/league/api.ts';
import type { MatchupBox, Scoreboard } from '../../web/src/lib/league/inseason/api.ts';
import { isOtherGame, otherGame } from '../../web/src/lib/league/box/game.ts';
import { matchupGap, scoreGap, scoreUnread, teamName } from '../../web/src/lib/league/model.ts';
import { cells } from './lineup-parity.ts';

export const MATCHUP_OUTPUT = 'shared/fixtures/parity/matchup.json';

/** The Team row as TeamFigures draws it. */
function teamRow(totals: BoxTotals): unknown {
	const small = teamSmallFigure(totals);
	return {
		note: totals.note,
		live: totals.live,
		caption: small?.caption ?? null,
		proj: boxNumber(small === null ? totals.proj : small.figure),
		pts: boxNumber(totals.pts)
	};
}

/** One team's box as BoxTable draws it on a phone: its rows ranked, no evidence line. */
function boxOf(team: string, mine: boolean, side: SideBox, empty: string | null): unknown {
	const row = (r: BoxRow): unknown => cells(null, r, null);
	return {
		team,
		mine,
		empty: empty !== null && side.starters.length === 0 ? empty : null,
		starters: side.starters.map((s) => row(s.row)),
		team_row: teamRow(side.totals),
		bench: side.bench.map(row)
	};
}

/** The Matchup at one clock as the web's phone draws it: at the read's instant, the read cell aged by
 * the page's clock (`clock`). Another team's game (the box's own viewer_side) is drawn from the box
 * and the scoreboard (`board`) as MatchupPanel draws it: its head says whose game it is, its bug no
 * You or Opponent, no note of the member's, no box of the member's. */
export function matchupAt(
	sync: LeagueSync,
	box: MatchupBox | null,
	clock: string,
	zone: string,
	board: Scoreboard | null = null
): unknown {
	const now = Date.parse(sync.read_at);
	const other = isOtherGame(box);
	const matchup = other ? otherGame(box, board) : sync.matchup;
	if (matchup === null) return { gap: matchupGap(sync, new Date(now)) };
	const starterLines = (box?.sides ?? []).flatMap((s) => s.starters.map((st) => st.line));
	const started = matchupStarted(starterLines, now);
	const unlisted = unlistedStates(box);
	const headFinal = matchupFinal(starterLines, now, unlisted);
	const sideOf = (s: MatchupSide): SideBox =>
		sideBox(
			s,
			box?.sides.find((b) => b.roster_id === s.roster_id) ?? null,
			{
				hostTotal: showsTotal(s, sync.week_all_play) ? s.points : null,
				landed: box?.projection_read_at != null,
				week: matchup.week,
				now,
				started,
				headFinal
			},
			zone
		);
	const countOf = (rosterId: number): string =>
		started ? (box?.sides.find((b) => b.roster_id === rosterId)?.to_play ?? '') : '';
	const mine = sideOf(matchup.mine);
	const theirs = matchup.opponent ? sideOf(matchup.opponent) : null;
	const theirsUnlisted =
		theirs === null
			? NONE_UNLISTED
			: matchupUnlisted(
					box?.sides.find((b) => b.roster_id === matchup.opponent?.roster_id) ?? null,
					theirs.totals
				);
	const kickoff = decidedHead(
		nextKickoff(starterLines, now, zone, unlisted),
		box?.decided === true,
		started
	);
	const read =
		started && kickoff?.head !== KICKOFF.final
			? readCell({ host: sync.host, readAt: sync.read_at }, Date.parse(clock))
			: null;
	const bugSide = (s: MatchupSide, side: SideBox, me: boolean): unknown => ({
		label: other ? '' : me ? BOX.you : BOX.opponent,
		name: teamName(sync, s.roster_id),
		...bugFigures(side.totals, started),
		toPlay: countOf(s.roster_id)
	});
	const lines = [...mine.lines, ...(theirs?.lines ?? [])];
	const parts = boxBasisParts(
		{
			byPlayer: mine.byPlayer,
			teamTotal: mine.teamTotal,
			host: sync.host,
			projection: box ? { readAt: box.projection_read_at, scoring: box.projection_scoring } : null,
			lines,
			kicked: started,
			noFinal: matchupNoFinal(mine.totals, theirs?.totals ?? null, theirsUnlisted),
			allFinal: [mine, theirs].every((s) => s === null || s.totals.allFinal),
			finalNone: [mine, theirs].some(
				(s) => s !== null && s.totals.live && s.totals.allFinal && s.totals.pts === null
			),
			unlisted: theirsUnlisted,
			lineup: null
		},
		{ zone, zoned: false },
		now
	);
	const opponent = matchup.opponent;
	return {
		clock,
		now: sync.read_at,
		...(other ? { whose: { head: MATCHUP.theirGame, link: MATCHUP.yourGame } } : {}),
		week: `Week ${String(matchup.week)}`,
		title: {
			mine: teamName(sync, matchup.mine.roster_id),
			opponent: opponent ? teamName(sync, opponent.roster_id) : null
		},
		bug: {
			week: `Week ${String(matchup.week)}`,
			mine: bugSide(matchup.mine, mine, true),
			opponent: opponent && theirs ? bugSide(opponent, theirs, false) : null,
			kickoff,
			started,
			read,
			standing: standingLine(box, started)
		},
		allPlay: sync.week_all_play && !other ? allPlayWords(sync.host) : null,
		scoreGap: scoreUnread(matchup.mine) && !other ? scoreGap(sync, new Date(now)) : null,
		noOpponent: !opponent && !sync.week_all_play ? BOX.noOpponent : null,
		boxes: [
			boxOf(
				teamName(sync, matchup.mine.roster_id),
				!other,
				mine,
				other && sync.host === 'ffpc' ? yoursOnlyWords(sync.host) : null
			),
			...(opponent && theirs
				? [
						boxOf(
							teamName(sync, opponent.roster_id),
							false,
							theirs,
							sync.host === 'ffpc' ? yoursOnlyWords(sync.host) : null
						)
					]
				: [])
		],
		basis: drawnText(parts, 'phone')
	};
}

/** The league read with no matchup: the week with no games, and a week we could not read. */
export function gapsOf(sync: LeagueSync, clock: string): unknown {
	const none = { ...sync, matchup: null };
	return {
		unread: matchupAt(none, null, clock, 'UTC'),
		noWeek: matchupAt({ ...none, week: 0 }, null, clock, 'UTC'),
		reads: readCases(sync)
	};
}

/** The read's states the gap sentences name (model.ts readLine): a fresh read, a platform signed
 * out, one not answering, a kept read being read again. */
const READ_STATES = {
	fresh: { host_signed_out: false, host_failed: false, host_stale_seconds: 0 },
	signedOut: { host_signed_out: true, host_failed: false, host_stale_seconds: 0 },
	failed: { host_signed_out: false, host_failed: true, host_stale_seconds: 0 },
	stale: { host_signed_out: false, host_failed: false, host_stale_seconds: 120 }
} as const;

/** The ages a read is said at: just now, minutes, hours. */
const READ_AGES = { now: 0, minutes: 5 * 60, hours: 2 * 60 * 60 } as const;

/** Every branch of the gap sentences (matchupGap and scoreGap over readLine and agoWords): each read
 * state at each age, on the platform's own name and FFPC's, whose verb differs. */
function readCases(sync: LeagueSync): unknown[] {
	const hosts: readonly LeagueSync['host'][] = ['ffpc', 'sleeper'];
	return hosts.flatMap((host) =>
		Object.entries(READ_STATES).flatMap(([state, flags]) =>
			Object.entries(READ_AGES).map(([age, seconds]) => {
				const read = { ...sync, ...flags, host };
				const now = new Date(Date.parse(sync.read_at) + seconds * 1000);
				return {
					host,
					state,
					age,
					seconds,
					gap: matchupGap(read, now),
					scoreGap: scoreGap(read, now)
				};
			})
		)
	);
}
