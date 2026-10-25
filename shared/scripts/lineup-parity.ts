/** The Start screen's parity (Lane 180): what the web's Lineup (StartScreen.svelte at 390 over
 * LineupStrip, LineupTable and BoxBasis) prints for the fixture league's lineup at each fixture clock,
 * in the fixture's zone, as JSON the apps' ports are held to: the strip (the week, the count of
 * changes, the sum, the chips, the API's sentences), every row's cells as the phone draws them, the
 * Team row, the bench and the injured reserve, the pinned verb and the line under it, the phone's
 * basis and the copied lineup. The fixture's FFPC league takes no lineups from here, so a second set
 * reads the same answers with the platform's writes open on ESPN (the verb that makes the changes);
 * and the move's own words (move.ts) are written for each platform that takes writes, with each of
 * its outcomes. Written by export-parity.ts beside the League home's parity. */
import {
	BOX,
	boxNumber,
	deltaWord,
	easeOf,
	fitName,
	oppRankWord,
	reserveRow,
	teamSmallFigure
} from '../../web/src/lib/league/box/box.ts';
import type { BoxRow } from '../../web/src/lib/league/box/box.ts';
import { boxBasisParts, drawnText } from '../../web/src/lib/league/box/basis.ts';
import {
	changesTitle,
	copiedLine,
	heldLineup,
	LINEUP,
	lineupBox,
	lineupPageWords,
	lineupSum,
	lineupText,
	setOnWords,
	swapWords,
	type LineupBox,
	type LineupRow
} from '../../web/src/lib/league/box/lineup.ts';
import type { LeagueHost } from '../../web/src/lib/league/api.ts';
import type { HostMoveResult, LineupAdvice } from '../../web/src/lib/league/inseason/api.ts';
import {
	hostSaid,
	lineupMove,
	lostWords,
	openHostWords,
	readingWords,
	resultWords,
	setsOnHost,
	settingWords
} from '../../web/src/lib/league/inseason/move.ts';
import { lineupDecision, verbWords } from '../../web/src/lib/league/inseason/words.ts';

export const LINEUP_OUTPUT = 'shared/fixtures/parity/lineup.json';

/** One row's cells as the phone draws them (BoxLine and BoxPlayer at 390), the Lineup's and the
 * Matchup's boxes alike (matchup-parity.ts). */
export interface RowCells {
	key: string;
	slot: string;
	move: 'in' | 'out' | null;
	idle: boolean;
	name: string;
	fit: string;
	slug: string | null;
	boardId: string | null;
	face: { mark: boolean; alt: string };
	club: string;
	position: string;
	status: { mark: string; sits: boolean } | null;
	rank: string;
	/** "bye", "no-club", the game's two halves, or null; the IR note in its place on the bench. */
	game: { where: string; when: string } | 'bye' | 'no-club' | null;
	note: string | null;
	expected: string | null;
	weather: { glyph: string; words: string } | null;
	proj: string;
	pts: string;
	/** The phone's evidence line: "Opp 2nd, Avg 23.3, Last 19.0", the rank's ease while to come. */
	evidence: string;
	oppRank: string | null;
	ease: 'easy' | 'hard' | 'even';
	delta: string;
	state: string | null;
	why: string | null;
}

/** The rank cell (BoxLine rankCell): empty on an injured reserve row, the rank, or "--". */
function rankCell(row: BoxRow, reserve: 'bench' | 'slot' | null): string {
	if (reserve !== null) return '';
	return row.pill && row.pill.rank !== null ? String(row.pill.rank) : BOX.none;
}

/** The phone's evidence line (BoxLine seasonLine), as one string. */
function evidenceLine(row: BoxRow): string {
	const rank = row.evidence.oppRank;
	const pairs = [
		`${BOX.avg} ${boxNumber(row.evidence.avg)}`,
		`${BOX.last} ${boxNumber(row.evidence.last)}`
	];
	return [...(rank === null ? [] : [`${BOX.opp} ${oppRankWord(rank)}`]), ...pairs].join(', ');
}

export function cells(
	entry: LineupRow | null,
	plain: BoxRow,
	reserve: 'bench' | 'slot' | null
): RowCells {
	const row = reserveRow(plain, reserve);
	const rank = row.evidence.oppRank;
	return {
		key: row.key,
		slot: row.slot,
		move: entry?.move ?? null,
		idle: entry?.idle ?? false,
		name: row.name,
		fit: fitName(row),
		slug: row.slug,
		boardId: row.boardId,
		face: { mark: row.face.mark, alt: row.face.alt },
		club: row.club,
		position: row.position,
		status: row.status === null ? null : { mark: row.status.mark, sits: row.status.sits },
		rank: rankCell(row, reserve),
		game: row.game,
		note: reserve === 'bench' ? BOX.irBench : null,
		expected: row.expected,
		weather: row.weather,
		proj: boxNumber(row.proj),
		pts: boxNumber(row.pts),
		evidence: evidenceLine(row),
		oppRank: rank === null ? null : oppRankWord(rank),
		ease: rank !== null && row.toCome ? easeOf(rank, row.evidence.oppOf) : 'even',
		delta: deltaWord(row.evidence.delta),
		state: row.state,
		why: entry?.why ?? null
	};
}

/** The Team row (LineupTable's totals and TeamFigures). */
function team(box: LineupBox): unknown {
	const small = teamSmallFigure(box.totals);
	return {
		note: box.totals.note,
		live: box.totals.live,
		caption: small?.caption ?? null,
		proj: boxNumber(small === null ? box.totals.proj : small.figure),
		pts: boxNumber(box.totals.pts)
	};
}

/** The pinned verb and the line under it, as StartScreen draws them before the verb is pressed:
 * Make these changes where the platform takes the lineup, else Copy the lineup with the platform's
 * page and the API's reason, none once the lineup is set or every starter has kicked off. */
function pinned(advice: LineupAdvice, box: LineupBox, host: LeagueHost): unknown {
	const done = advice.week_done ?? null;
	const onHost = setsOnHost(advice);
	const isSet = box.swaps.length === 0;
	const verb = isSet ? null : onHost ? LINEUP.make : LINEUP.copy;
	const footSays = done !== null ? false : isSet ? advice.moves.lineup === 'available' : !onHost;
	let page: string | null = null;
	let line: string | null = null;
	if (done === null && isSet && advice.moves.lineup === 'available') line = setOnWords(host);
	else if (done === null && !isSet && !onHost) {
		page = advice.host_lineup_url === '' ? null : lineupPageWords(host);
		line = advice.moves.reason ?? advice.host_note ?? '';
	}
	return { verb, onHost, footSays, page, line, url: advice.host_lineup_url };
}

/** The Lineup at one clock, as the web's phone draws it. */
export function lineupAt(
	answer: LineupAdvice,
	host: LeagueHost,
	now: string,
	zone: string
): unknown {
	const at = Date.parse(now);
	const advice = heldLineup(answer, at);
	const done = advice.week_done ?? null;
	const box = lineupBox(advice, zone, at);
	const shown = [
		...advice.slots.flatMap((s) => (s.host ? [s.ours, s.host] : [s.ours])),
		...advice.bench,
		...advice.reserve
	];
	const basis = boxBasisParts(
		{
			byPlayer: advice.player_points,
			teamTotal: false,
			host,
			projection: { readAt: advice.projection_read_at, scoring: advice.projection_scoring },
			lineup: { previousReadAt: advice.projection_previous_read_at, note: advice },
			lines: shown,
			noFinal: box.totals.live && box.totals.final === null,
			allFinal: box.totals.allFinal
		},
		{ zone, zoned: false },
		at
	);
	const move = lineupMove(advice);
	return {
		now,
		week: advice.week,
		title: changesTitle(box.swaps.length, done, advice.week_done_state ?? null),
		decision: lineupDecision(advice),
		sum: lineupSum(box, host, done),
		done,
		missed: advice.missed ?? null,
		chipsShown: done === null && (box.swaps.length > 0 || box.idle.length > 0),
		idle: box.idle,
		swaps: box.swaps.map((swap) => ({ ...swap, words: swapWords(swap) })),
		starters: box.starters.map((entry) => cells(entry, entry.row, null)),
		empty: box.empty,
		team: team(box),
		bench: box.bench.map((entry) => cells(entry, entry.row, entry.row.reserve ? 'bench' : null)),
		reserve: box.reserve.map((row) => cells(null, row, 'slot')),
		pinned: pinned(advice, box, host),
		changes: move.changes,
		copy: lineupText(box, advice.week),
		copied: copiedLine(host, true),
		copyFailed: copiedLine(host, false),
		basis: drawnText(basis, 'phone')
	};
}

/** The answer as a platform that takes lineups from here would send it: the move open, no reason. */
export function withWrites(answer: LineupAdvice): LineupAdvice {
	return {
		...answer,
		moves: { lineup: 'available', note: null, takes_writes: true, writes_on: true, reason: null }
	};
}

/** A move's outcome as the API words it, for the words built over it. */
const RESULTS: readonly HostMoveResult[] = [
	{
		outcome: 'done',
		sentence: 'Your lineup is set on ESPN.',
		host_words: null,
		host_url: 'https://fantasy.espn.com/football/team',
		move_id: '00000000-0000-4000-8000-000000000001',
		processes_at: null
	},
	{
		outcome: 'refused',
		sentence: 'ESPN did not take the move, and nothing changed.',
		host_words: 'Lineup transaction could not be completed, Alexander Mattison is locked',
		host_url: 'https://fantasy.espn.com/football/team',
		move_id: '00000000-0000-4000-8000-000000000002',
		processes_at: null
	},
	{
		outcome: 'pending',
		sentence: 'We sent it, and ESPN has not shown it yet. Check your lineup on ESPN.',
		host_words: null,
		host_url: 'https://fantasy.espn.com/football/team',
		move_id: '00000000-0000-4000-8000-000000000003',
		processes_at: null
	}
];

/** The move's words (move.ts) for each platform that takes writes: the confirmation's verb, its
 * reading and sending lines, the host's page, a move that never answered, and each outcome's line
 * with the host's own words under a refusal. */
export function moveWords(): unknown {
	const hosts: readonly LeagueHost[] = ['espn', 'mfl', 'sleeper', 'yahoo', 'ffpc'];
	return hosts.map((host) => ({
		host,
		verb: verbWords('start', host),
		reading: readingWords(host),
		setting: settingWords(host),
		open: openHostWords(host),
		lost: lostWords(host),
		results: RESULTS.map((result) => ({
			outcome: result.outcome,
			sentence: result.sentence,
			hostWords: result.host_words,
			words: resultWords(host, result),
			said: result.host_words === null ? null : hostSaid(host, result.host_words)
		}))
	}));
}
