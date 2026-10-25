/** The live-draft companion's parity (Lane 210): what the web's companion page prints at 390
 * (web/src/lib/companion: CompanionPage, CompanionRoom, CompanionBar, Shortlist, and the rooms' call,
 * pool, strips and team it draws, then the report) over the recorded replay in
 * shared/fixtures/companion, read in order as the page reads it (the first answer with the board, each
 * later one merged onto the picks held), as JSON the apps' ports are held to: per moment the bar, the
 * notes, the strip of picks as they land, at the drafter's turn the picks since his last and the call
 * with the shortlist, between turns the call that waits on the board, the pool under every chip with
 * its basis and chances, and the team; the report's hero, cells, basis, field, pick by pick, runs and
 * exposure; the followed drafts' lines; and the sentences the replay never reaches (a draft not
 * started or paused, a platform gone quiet, a pick our draft cannot follow, unplaced, named and traded
 * picks) over edited copies of a recorded answer. Written by export-parity.ts beside the others. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPOSITORY } from './generated.ts';
import { chanceShort, lastName, pickLabel, snakeSlot } from '../../web/src/lib/format/draft.ts';
import { gapText } from '../../web/src/lib/format/gap.ts';
import { count, signed } from '../../web/src/lib/format/number.ts';
import { isMarketPosition } from '../../web/src/lib/run/market.ts';
import { heatFor, vorLabel } from '../../web/src/lib/ui/heat.ts';
import { callTag, callView, chanceHead, poolBasis } from '../../web/src/lib/room/call.ts';
import {
	boardOf,
	draftedSet,
	poolRows,
	teamSlots,
	turnBefore,
	wentSince,
	type Board,
	type PoolFilter,
	type RoomPlayer
} from '../../web/src/lib/room/model.ts';
import {
	chanceMissing,
	leagueLine,
	poolEmpty,
	poolLine,
	showMore,
	sinceLead,
	slotLabel,
	teamCount
} from '../../web/src/lib/room/words.ts';
import {
	REPORT,
	adpLater,
	boardLater,
	byWords,
	exposureAside,
	exposureTitle,
	fieldNote,
	middleWords,
	pickFigure,
	picksNote,
	points,
	reportBasis,
	reportTitle,
	runsNote,
	runsTitle,
	seatName,
	settingCells,
	standingCells,
	stillThereCell,
	topShareWords,
	totalCaption
} from '../../web/src/lib/room/report/headline.ts';
import {
	chanceColumn,
	chanceLabel,
	companionNotes,
	draftName,
	draftOnWords,
	hostDraftUrl,
	justTakenWords,
	landingStrip,
	leagueOnWords,
	lostWords,
	makePickWords,
	mergePicks,
	openDraftWords,
	pickCount,
	picksMadeWords,
	queueWords,
	recentLine,
	roomPicks,
	seatNames,
	staleWords,
	turnWords
} from '../../web/src/lib/companion/model.ts';
import { COMPANION } from '../../web/src/lib/companion/words.ts';
import type {
	Companion,
	CompanionPick,
	CompanionSummary
} from '../../web/src/lib/companion/api.ts';
import type { MockReport } from '../../web/src/lib/room/api.ts';

export const COMPANION_OUTPUT = 'shared/fixtures/parity/companion.json';
const FIXTURES = join(REPOSITORY, 'shared/fixtures/companion');
/** The recorded moments, in the order the page read them. */
export const MOMENTS = ['waiting', 'between', 'turn', 'taken', 'complete'] as const;
/** The pool's chips, as the companion offers them. */
const FILTERS: readonly PoolFilter[] = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST'];
/** The pool's first rows (Pool.svelte FIRST_ROWS) and how many each Show more adds (MORE_ROWS). */
const FIRST_ROWS = 14;
const MORE_ROWS = 25;
/** The rows Exposure lists (Exposure.svelte ROWS) and the runs' histogram bars (RunsSection BINS). */
const EXPOSURE_ROWS = 8;
const BINS = 12;

async function answer<T>(file: string): Promise<T> {
	const envelope = JSON.parse(await readFile(join(FIXTURES, file), 'utf8')) as {
		data: T;
	};
	return envelope.data;
}

/** A player as a row names him: id, name, pill, club. */
function who(p: RoomPlayer): {
	id: string;
	name: string;
	pill: string;
	team: string;
} {
	return {
		id: p.id,
		name: p.name,
		pill: `${p.position} ${String(p.positionRank)}`,
		team: p.team
	};
}

/** A pool or call row's value cell as PoolRow and CallPanel print it. */
function valueCell(p: RoomPlayer): {
	text: string;
	label: string | null;
	heat: string | null;
} {
	if (p.vor !== null && p.vorRound !== null) {
		return {
			text: signed(p.vor),
			label: vorLabel(p.vor, p.vorRound),
			heat: heatFor(p.vor, p.vorRound)
		};
	}
	return {
		text: isMarketPosition(p.position) ? `Draft order ${String(p.positionRank)}` : 'no projection',
		label: null,
		heat: null
	};
}

/** The bar, the notes and the strips, the call and the pool at one moment, as CompanionRoom draws
 * them. `seen` is how many name-matched picks the drafter was told of before (CompanionRoom's
 * namedSeen). */
function room(c: Companion, picks: readonly CompanionPick[], board: Board, seen: number) {
	const teams = c.teams;
	const placed = roomPicks(picks);
	const drafted = draftedSet(placed);
	const now = c.pick_count + 1;
	const round = snakeSlot(Math.min(now, c.total_picks), teams).round;
	const prev = turnBefore(now, c.slot, teams);
	const card = c.card;
	const call =
		card && (c.your_turn || card.conditional) ? callView(card, board, drafted, teams) : null;
	const onTurn = call !== null && c.your_turn;
	const label = chanceLabel(card, teams);
	const names = seatNames(c);
	const strip = landingStrip(picks, board, teams, c.slot, names);
	const went = wentSince(placed, prev ?? 0, new Set(), board);
	const named = c.your_turn ? c.placed_by_name.slice(seen) : c.placed_by_name;
	const chances = card?.still_there ?? {};
	const pool = FILTERS.map((filter) => {
		const rows = poolRows(board, drafted, filter, [], '');
		return {
			filter,
			count: rows.length,
			empty: rows.length === 0 ? poolEmpty('', filter) : null,
			more:
				rows.length > FIRST_ROWS ? showMore(Math.min(MORE_ROWS, rows.length - FIRST_ROWS)) : null,
			rows: rows.slice(0, FIRST_ROWS).map((p) => ({
				...who(p),
				value: valueCell(p),
				chance:
					call === null
						? null
						: chances[p.id] === undefined
							? null
							: chanceShort(chances[p.id] ?? 0),
				call: p.id === call?.player.id
			}))
		};
	});
	return {
		status: c.status,
		round,
		bar: {
			figure: pickCount(c),
			caption: picksMadeWords(c.host),
			section: draftOnWords(c.host),
			title: draftName(c),
			league: leagueLine(c.settings, c.slot),
			turn: turnWords(c),
			onTurn: c.your_turn,
			stale: staleWords(c),
			open: openDraftWords(c.host),
			openURL: hostDraftUrl(c)
		},
		lost: lostWords(c),
		notes: companionNotes(c, named),
		names,
		strip:
			strip.length > 0 && !onTurn
				? {
						lead: pickLabel(picks.at(-1)?.pick ?? 1, teams),
						lines: [justTakenWords(c.host), COMPANION.newestFirst],
						picks: strip.map((s) => ({
							id: s.player.id,
							name: lastName(s.player.name),
							lines: s.lines,
							newest: s.ring === 'ink',
							strong: s.strong === true
						}))
					}
				: null,
		since:
			call && card && onTurn && went.length > 0
				? {
						lead: String(went.length),
						lines: [sinceLead(prev, teams, 'your')],
						picks: went.map((w) => ({
							id: w.player.id,
							name: lastName(w.player.name),
							lines: [pickLabel(w.pick, teams)]
						}))
					}
				: null,
		call:
			call === null
				? null
				: {
						tag: callTag(call),
						chanceHead: chanceHead(call),
						verb: onTurn ? makePickWords(c.host) : queueWords(c.host),
						waiting: call.conditional,
						rows: call.rows.map((r) => ({
							...who(r.player as RoomPlayer),
							value: isMarketPosition(r.player.position)
								? `Draft order ${String(r.player.positionRank)}`
								: r.vor === null
									? ''
									: signed(r.vor),
							chance: chanceHead(call) === null || r.chance === null ? '' : chanceShort(r.chance),
							adp: r.adp,
							gap: gapText(r.gap ?? null)
						}))
					},
		shortlist:
			call && card && onTurn
				? card.shortlist
						.filter((s) => s.player_id !== card.call)
						.flatMap((s) => {
							const p = board.byId.get(s.player_id);
							const chance = card.still_there[s.player_id] ?? null;
							return p
								? [
										{
											...who(p),
											chance: chance === null ? null : chanceShort(chance),
											label
										}
									]
								: [];
						})
				: null,
		pool:
			c.status === 'complete'
				? null
				: {
						line: poolLine(board.players.length - drafted.size),
						basis: call ? poolBasis(board, card, teams) : c.basis,
						chanceHead: call !== null ? chanceColumn(card) : null,
						chanceLabel: label,
						missing: chanceMissing(false, Object.keys(chances).length > 0),
						views: pool
					},
		team: (() => {
			const slots = teamSlots(
				c.settings,
				placed.filter((p) => p.seat === c.slot),
				board
			);
			return {
				count: teamCount(slots.filter((s) => s.player !== null).length, c.rounds),
				slots: slots.map((s) => ({
					slot: s.slot,
					id: s.player?.id ?? null,
					pick: s.pick === null ? null : pickLabel(s.pick, teams)
				}))
			};
		})()
	};
}

/** The report as Report.svelte and its sections print it at 390, for the companion's seats. */
function report(r: MockReport, names: readonly string[], host: Companion['host']) {
	const board = boardOf(r.board, r.teams);
	const head = standingCells(r.standings, r.slot, r.teams);
	const top = Math.max(...r.standings.map((t) => t.points), 1);
	const lastPick = r.picks.filter((p) => p.chip !== 'kept').at(-1)?.pick ?? null;
	const slotOf = new Map(
		r.starters.flatMap((s) =>
			s.player_id === null ? [] : [[s.player_id, slotLabel(s.slot)] as const]
		)
	);
	const runs = r.runs;
	const lo = runs.points[0] ?? 0;
	const hi = runs.points.at(-1) ?? 0;
	const width = (hi - lo) / BINS || 1;
	const bins = Array.from({ length: BINS }, () => 0);
	for (const x of runs.points) {
		const bin = Math.min(BINS - 1, Math.floor((x - lo) / width));
		bins[bin] = (bins[bin] ?? 0) + 1;
	}
	return {
		title: reportTitle(r.slot),
		points: head ? points(head.points) : null,
		caption: totalCaption('your'),
		cells: [...(head?.cells ?? []), ...settingCells(r, leagueOnWords(host))].map((c) => ({
			label: c.label,
			value: c.value,
			mine: c.mine === true
		})),
		verb: COMPANION.followAnother,
		basis: reportBasis(board.basis, r.could_wait_from),
		field: {
			note: fieldNote(r.teams),
			rows: r.standings.map((t) => ({
				rank: t.rank,
				name: seatName(names, t.seat),
				points: count(t.points),
				share: t.points / top,
				you: t.seat === r.slot
			}))
		},
		picks: {
			note: picksNote(r.picks.length),
			rows: r.picks.map((p) => {
				const player = board.byId.get(p.player_id);
				const still = stillThereCell(p, lastPick, r.could_wait_from);
				return {
					pick: pickLabel(p.pick, r.teams),
					id: p.player_id,
					name: player?.name ?? p.player_id,
					slot: slotOf.get(p.player_id) ?? REPORT.bench,
					figure: pickFigure(p.over_replacement, player),
					adp: adpLater(p),
					ours: boardLater(p),
					still,
					by: byWords(p, 'your')
				};
			})
		},
		runs: {
			title: runsTitle(runs.runs),
			note: runsNote('your', COMPANION.reshuffled),
			bins,
			medianBin: Math.min(BINS - 1, Math.floor((runs.median - lo) / width)),
			low: count(lo),
			high: count(hi),
			median: count(runs.median),
			middle: middleWords(runs.middle_low, runs.middle_high),
			topShare: `${String(Math.round(runs.top_share * 100))}%`,
			topWords: topShareWords(runs.top_finish, r.teams),
			ranks: runs.rank_counts,
			rank: head?.rank ?? 0
		},
		exposure: {
			title: exposureTitle('your'),
			aside: exposureAside(runs.runs),
			rows: runs.exposure.slice(0, EXPOSURE_ROWS).flatMap((e) => {
				const p = board.byId.get(e.player_id);
				return p
					? [
							{
								...who(p),
								share: e.share,
								percent: `${String(Math.round(e.share * 100))}%`
							}
						]
					: [];
			})
		}
	};
}

/** The sentences the replay never reaches, over edited copies of a recorded answer. */
function edges(c: Companion) {
	const named = [
		{ host_name: 'Kenneth Walker', board_name: 'Kenneth Walker III' },
		{ host_name: 'Marvin Harrison', board_name: 'Marvin Harrison Jr.' },
		{ host_name: 'DJ Moore', board_name: 'D.J. Moore' },
		{ host_name: 'Hollywood Brown', board_name: 'Marquise Brown' }
	];
	return {
		preDraft: turnWords({ ...c, status: 'pre_draft' }),
		paused: turnWords({ ...c, status: 'paused' }),
		pausedOnTurn: turnWords({ ...c, status: 'paused', your_turn: true }),
		lastPicksIn: turnWords({
			...c,
			your_next_pick: null,
			picks_until_turn: null
		}),
		over: turnWords({ ...c, status: 'complete' }),
		stale: staleWords({ ...c, host_stale_seconds: 14 }),
		lost: lostWords({ ...c, lost_at: 37 }),
		unnamed: draftName({ name: '' }),
		notesOne: companionNotes({ ...c, unplaced: 1, traded: 1 }, named.slice(0, 1)),
		notesMany: companionNotes({ ...c, unplaced: 3, traded: 2 }, named),
		chanceLast: chanceLabel(
			c.card ? { ...c.card, conditional: false, next_pick: null } : null,
			c.teams
		),
		ffpcURL: hostDraftUrl({ host: 'ffpc', host_draft_id: c.host_draft_id }),
		ffpcTurn: turnWords({ ...c, host: 'ffpc' }),
		missing: {
			gone: chanceMissing(true, false),
			coming: chanceMissing(false, false)
		},
		empty: { searched: poolEmpty('zz', 'WR'), left: poolEmpty('', 'K') }
	};
}

export async function renderCompanion(about: string): Promise<string> {
	let held: CompanionPick[] = [];
	let board: Board | null = null;
	let seen = 0;
	let last: Companion | null = null;
	let between: Companion | null = null;
	const moments: Record<string, unknown> = {};
	for (const name of MOMENTS) {
		const c = await answer<Companion>(`companion-${name}.json`);
		if (c.board) board = boardOf(c.board, c.teams);
		if (!board) throw new Error(`companion-${name}.json: no board read yet`);
		// CompanionRoom's namedSeen: between turns every name-matched pick has been told.
		if (last && !last.your_turn) seen = last.placed_by_name.length;
		held = mergePicks(held, c);
		moments[name] = {
			since: c.since,
			picks: held.length,
			...room(c, held, board, seen)
		};
		last = c;
		if (name === 'between') between = c;
	}
	if (!last || !between) throw new Error('no moments read');
	const recent = await answer<CompanionSummary[]>('companions.json');
	return `${JSON.stringify(
		{
			about,
			moments,
			report: report(await answer<MockReport>('report.json'), seatNames(last), last.host),
			recent: recent.map((r) => {
				const line = recentLine(r, '');
				return { lead: line.lead, text: line.text };
			}),
			edges: edges(between)
		},
		null,
		'\t'
	)}\n`;
}
