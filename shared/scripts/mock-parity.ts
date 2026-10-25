/** The solo mock's parity (Lane 213): what the web's mock room prints at 390 (web/src/lib/room:
 * SoloRoom, SoloBar, the call, the pool, the strip since your pick, the wall and the team; the setup
 * page; a shared draft's head; the report) over the recorded draft in shared/fixtures/mock-room, read in
 * order as the room reads it (the first answer with the board, each later one onto that board), as JSON
 * the apps' ports are held to. Written by export-parity.ts beside the others. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPOSITORY } from './generated.ts';
import { chanceShort, lastName, pickLabel, snakeSlot } from '../../web/src/lib/format/draft.ts';
import { count, signed } from '../../web/src/lib/format/number.ts';
import { isMarketPosition } from '../../web/src/lib/run/market.ts';
import { heatFor } from '../../web/src/lib/ui/heat.ts';
import {
	callTag,
	callView,
	chanceHead,
	draftWords,
	frameView,
	poolBasis
} from '../../web/src/lib/room/call.ts';
import {
	boardOf,
	draftedSet,
	poolRows,
	teamSlots,
	turnAfter,
	turnBefore,
	wallRows,
	wentSince,
	type Board,
	type PoolFilter,
	type RoomPlayer
} from '../../web/src/lib/room/model.ts';
import {
	botNames,
	chanceMissing,
	formatLine,
	pickBarCells,
	poolEmpty,
	poolLine,
	sinceLead,
	sinceQueued,
	slotLabel,
	straightBack,
	teamCount
} from '../../web/src/lib/room/words.ts';
import {
	MOCK,
	autopickWords,
	chanceLabel,
	draftNamed,
	pickHead,
	readingWords,
	runAgainWords,
	runSharedWords,
	sharedAt,
	sharedTitle,
	undoneWords
} from '../../web/src/lib/room/mock-words.ts';
import {
	LINEUP_CHOICES,
	SCORING_CHOICES,
	TEAM_CHOICES,
	defaultSettings,
	setupCells
} from '../../web/src/lib/room/setup/setup.ts';
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
import type { components } from '../../web/src/lib/api/types.ts';

type Schemas = components['schemas'];
type MockRoom = Schemas['MockRoom'];
type RoomCard = Schemas['RoomCard'];
type MockReport = Schemas['MockReport'];

export const MOCK_OUTPUT = 'shared/fixtures/parity/mock.json';
const FIXTURES = join(REPOSITORY, 'shared/fixtures/mock-room');

/** The room's states, each a recorded answer read onto the first answer's board, in draft order. */
export const STATES = [
	'create',
	'pick-1',
	'pick-2',
	'pick-3',
	'pick-4',
	'round5',
	'queue',
	'undo',
	'pick-again',
	'autopick'
] as const;

/** SoloRoom.svelte FILTERS and AUTOPICK_ROUNDS, Pool.svelte FIRST_ROWS. */
const FILTERS: readonly PoolFilter[] = ['All', 'QB', 'RB', 'WR', 'TE', 'K', 'DST', 'Queue'];
const AUTOPICK_ROUNDS = 3;
const FIRST_ROWS = 14;
const EXPOSURE_ROWS = 8;
const BINS = 12;

async function answer<T>(file: string): Promise<T> {
	const envelope = JSON.parse(await readFile(join(FIXTURES, `${file}.json`), 'utf8')) as {
		data: T;
	};
	return envelope.data;
}

/** The turn's card as the room page settles it: a write that keeps the turn keeps its card; a new
 * turn takes the card its answer carries, else the one read from the route at that pick. */
async function cardFor(
	room: MockRoom,
	held: { pick: number; card: RoomCard | null } | null
): Promise<RoomCard | null> {
	if (!room.waiting) return null;
	if (room.card?.pick_number === room.pick_number) return room.card;
	if (held?.pick === room.pick_number) return held.card;
	const read = await answer<RoomCard>('card-first');
	return read.pick_number === room.pick_number ? read : null;
}

/** A pool or call row's value cell as PoolRow and CallPanel print it. */
function valueCell(p: RoomPlayer): { text: string; heat: string | null } {
	if (p.vor !== null && p.vorRound !== null)
		return { text: signed(p.vor), heat: heatFor(p.vor, p.vorRound) };
	return {
		text: isMarketPosition(p.position) ? `Draft order ${String(p.positionRank)}` : 'no projection',
		heat: null
	};
}

function callValue(p: RoomPlayer): string {
	if (isMarketPosition(p.position)) return `Draft order ${String(p.positionRank)}`;
	return p.vor === null ? '' : signed(p.vor);
}

/** The solo room at one answer, as SoloRoom draws it at 390 with nothing marked and no write in
 * flight. `shared` reads it as someone else's draft. */
function room(r: MockRoom, board: Board, card: RoomCard | null, shared: boolean) {
	const teams = r.teams;
	const total = teams * r.rounds;
	const drafted = draftedSet(r.picks);
	const mine = r.picks.filter((p) => p.seat === r.slot);
	const round = snakeSlot(Math.min(r.pick_number, total), teams).round;
	const next = turnAfter(r.pick_number, r.slot, teams, total);
	const prev = turnBefore(r.pick_number, r.slot, teams);
	const queue = r.queue.filter((id) => !drafted.has(id));
	const queueAll = new Set(r.queue);
	const call = !shared && card && r.waiting ? callView(card, board, drafted, teams) : null;
	const chances = card?.still_there ?? {};
	const went = wentSince(r.picks, prev ?? 0, queueAll, board);
	const whose = shared ? 'their' : 'your';
	const lastMine = mine.at(-1)?.pick ?? null;
	const autopickTo = Math.min(r.rounds, round + AUTOPICK_ROUNDS);
	const frame = next === null ? null : frameView(board, drafted, teams, next);
	return {
		pick: r.pick_number,
		waiting: r.waiting,
		head: pickHead(r.pick_number, teams),
		cells: pickBarCells(r.settings, r.slot, { now: r.pick_number, round, next }).map((c) => ({
			label: c.label,
			value: c.value,
			word: c.word === true
		})),
		autopickTo,
		autopick: autopickWords(autopickTo),
		canUndo: lastMine !== null,
		lastMine,
		reading: next === null ? null : readingWords(next, teams),
		frame: frame?.rows.map((row) => row.player.id) ?? [],
		call: call
			? {
					tag: callTag(call),
					chanceHead: chanceHead(call),
					verb: draftWords(call.player.position),
					rows: call.rows.map((row) => ({
						id: row.player.id,
						value: callValue(row.player),
						chance: chanceHead(call) === null || row.chance === null ? '' : chanceShort(row.chance)
					}))
				}
			: null,
		since:
			r.waiting && (lastMine !== null || went.length > 0)
				? {
						lead: String(went.length),
						lines:
							queueAll.size > 0
								? [
										sinceLead(prev, teams, whose),
										sinceQueued(went.filter((w) => w.queued).length, whose)
									]
								: [sinceLead(prev, teams, whose)],
						straight: prev !== null && went.length === 0 ? straightBack(whose) : null,
						faces: went.map((w) => ({
							pick: w.pick,
							id: w.player.id,
							name: lastName(w.player.name),
							lines: w.queued ? [pickLabel(w.pick, teams), 'queued'] : [pickLabel(w.pick, teams)]
						}))
					}
				: null,
		pool: {
			line: poolLine(board.players.length - drafted.size),
			basis: shared ? board.basis : poolBasis(board, card, teams, false),
			chanceLabel: chanceLabel(card?.next_pick ?? null, teams),
			missing: chanceMissing(false, Object.keys(chances).length > 0),
			filters: (shared ? FILTERS.filter((f) => f !== 'Queue') : FILTERS).map((filter) => {
				const rows = poolRows(board, drafted, filter, queue, '');
				return {
					filter,
					count: rows.length,
					empty: rows.length === 0 ? poolEmpty('', filter) : null,
					rows: rows.slice(0, FIRST_ROWS).map((p) => ({
						id: p.id,
						value: valueCell(p),
						chance: shared || chances[p.id] === undefined ? null : chanceShort(chances[p.id] ?? 0),
						call: p.id === call?.player.id,
						queued: queue.includes(p.id)
					}))
				};
			})
		},
		wall: {
			names: botNames(teams, r.slot).map((n, i) =>
				shared && i + 1 === r.slot ? (r.shared_by ?? MOCK.drafter) : n
			),
			rows: wallRows(r.picks, board, teams, Math.min(r.rounds, round)).map((row) =>
				row.map((cell) => cell.player?.id ?? null)
			)
		},
		team: (() => {
			const slots = teamSlots(r.settings, mine, board);
			return {
				count: teamCount(slots.filter((s) => s.player !== null).length, r.rounds),
				slots: slots.map((s) => ({
					slot: s.slot,
					id: s.player?.id ?? null,
					pick: s.pick === null ? null : pickLabel(s.pick, teams)
				}))
			};
		})()
	};
}

/** The report as Report.svelte draws it, for your draft or a shared one. */
function report(
	r: MockReport,
	names: readonly string[],
	shared: { by: string | null } | undefined
) {
	const board = boardOf(r.board, r.teams);
	const head = standingCells(r.standings, r.slot, r.teams);
	const whose = shared ? 'their' : 'your';
	const top = Math.max(...r.standings.map((t) => t.points), 1);
	const last = r.picks.filter((p) => p.chip !== 'kept').at(-1)?.pick ?? null;
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
		title: reportTitle(r.slot, shared),
		points: head ? points(head.points) : null,
		caption: totalCaption(whose),
		cells: [...(head?.cells ?? []), ...settingCells(r, MOCK.botsByAdp)].map((c) => ({
			label: c.label,
			value: c.value,
			mine: c.mine === true
		})),
		verbs: shared
			? [runSharedWords(r.slot), MOCK.setUpOwn]
			: [runAgainWords(r.slot), MOCK.tryAnother, MOCK.copyLink],
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
				return {
					pick: pickLabel(p.pick, r.teams),
					id: p.player_id,
					slot: slotOf.get(p.player_id) ?? REPORT.bench,
					figure: pickFigure(p.over_replacement, player),
					adp: adpLater(p),
					ours: boardLater(p),
					still: stillThereCell(p, last, r.could_wait_from),
					by: byWords(p, whose)
				};
			})
		},
		runs: {
			title: runsTitle(runs.runs),
			note: runsNote(whose, MOCK.reshuffled),
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
			title: exposureTitle(whose),
			aside: exposureAside(runs.runs),
			rows: runs.exposure
				.slice(0, EXPOSURE_ROWS)
				.flatMap((e) => (board.byId.get(e.player_id) ? [{ id: e.player_id, share: e.share }] : []))
		}
	};
}

export async function renderMock(about: string): Promise<string> {
	const first = await answer<MockRoom>('create');
	if (!first.board) throw new Error('The first answer came back without its board.');
	const board = boardOf(first.board, first.teams);
	const states: Record<string, unknown> = {};
	let held: { pick: number; card: RoomCard | null } | null = null;
	for (const state of STATES) {
		const r = await answer<MockRoom>(state);
		const card = await cardFor(r, held);
		held = { pick: r.pick_number, card };
		states[state] = room(r, board, card, false);
	}
	const round5 = await answer<MockRoom>('round5');
	const undone = round5.picks.filter((p) => p.seat === round5.slot).at(-1);
	const undonePlayer = undone ? board.byId.get(undone.player_id) : undefined;
	const shared = await answer<MockRoom>('shared-round5');
	const sharedBoard = shared.board ? boardOf(shared.board, shared.teams) : board;
	const sharedNames = (r: { teams: number; slot: number }, by: string | null | undefined) =>
		botNames(r.teams, r.slot).map((n, i) => (i + 1 === r.slot ? (by ?? MOCK.drafter) : n));
	const sharedComplete = await answer<MockRoom>('shared-complete');
	const defaults = defaultSettings();
	const down = await answer<MockReport>('report-down');
	const parity = {
		about,
		setup: {
			title: MOCK.setupTitle,
			cells: setupCells(undefined).map((c) => ({ label: c.label, value: c.value })),
			scoring: SCORING_CHOICES.map((c) => c.label),
			lineups: LINEUP_CHOICES.map((c) => c.label),
			teams: TEAM_CHOICES,
			line: formatLine(defaults),
			start: MOCK.start
		},
		states,
		undo: {
			pick: undone?.pick ?? null,
			words: undone ? undoneWords(undone.pick, round5.teams, undonePlayer?.name ?? null) : null
		},
		noCall: {
			verb: draftNamed(poolRows(board, draftedSet(first.picks), 'All', [], '')[0]?.name ?? ''),
			basis: poolBasis(board, null, first.teams, true),
			missing: chanceMissing(true, false)
		},
		shared: {
			title: sharedTitle(shared.shared_by, shared.slot),
			line: `${formatLine(shared.settings)} · ${sharedAt(shared.status === 'complete', shared.pick_number, shared.teams)}`,
			verb: runSharedWords(shared.slot),
			note: MOCK.sharedNote,
			room: room(shared, sharedBoard, null, true)
		},
		reports: {
			first: report(
				await answer<MockReport>('report'),
				botNames(first.teams, first.slot),
				undefined
			),
			down: report(down, botNames(down.teams, down.slot), undefined),
			shared: report(
				await answer<MockReport>('shared-report'),
				sharedNames(sharedComplete, sharedComplete.shared_by),
				{ by: sharedComplete.shared_by ?? null }
			)
		}
	};
	return `${JSON.stringify(parity, null, '\t')}\n`;
}
