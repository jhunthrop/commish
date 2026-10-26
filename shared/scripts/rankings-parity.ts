/** The Rankings screen's parity (Lane 194): what the web's Players page in season draws at 390
 * (routes/(run)/players/+page.svelte over order/OrderScreen.svelte, OrderTable.svelte, WeekScreen.svelte
 * and WeekTable.svelte) for each order answer the fixture API gave with no league, in the fixture's
 * zone, as JSON the apps' ports are held to: the page's name and the sentence under it, the search's
 * hits, every row as the phone draws it (its place, the API's rank, the player cell with his pill, his
 * game with its zone, the expected score and weather, his figures as the web's strip draws them (cells,
 * each head and value), the week's figure and his Projected) in its section, whether Show more is offered, and the phone's basis; for
 * the kickers' and defenses' week its sections and their heads, its rows, the status line before the
 * week's projection is in, the basis line with the rules our stats lack, and a search over it.
 * Written by export-parity.ts beside the others.
 *
 * Since Lane 209 the web's phone row draws its figures as labelled cells (FigureStrip), pinned here as
 * `cells` from the web's own builders (stripCells, weekStripCells). The apps' rows still fold the
 * figures into one line under the name with the shorter "Opp" sentence: `folded` and the basis's Opp
 * sentence keep what the apps draw, their values from the web's cell builders, until B196 draws the
 * strip in the apps and both go. */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { hitsWords } from '../../web/src/lib/format/pool-words.ts';
import { weekHead } from '../../web/src/lib/format/figure-words.ts';
import { OPP_PART, OPP_PHONE, drawnText } from '../../web/src/lib/league/box/basis.ts';
import {
	figureCell,
	formCells,
	oppCell,
	type StripCell
} from '../../web/src/lib/league/box/figure-strip.ts';
import {
	BOX,
	boxNumber,
	fitName,
	positionWord,
	type BoxRow
} from '../../web/src/lib/league/box/box.ts';
import type { OrderAdvice, WeekOrderAdvice } from '../../web/src/lib/order/api.ts';
import {
	FIGURE_HEADS,
	ORDER,
	PLAYERS_CHIPS,
	figureColumns,
	orderBasis,
	orderSections,
	orderView,
	stripCells,
	weekChip,
	type OrderView,
	type PlayersChip
} from '../../web/src/lib/order/order.ts';
import { MIN_SEARCH } from '../../web/src/lib/order/path.ts';
import {
	landed,
	weekStripCells,
	rulesLeftOut,
	weekBasis,
	weekNone,
	weekSearch,
	weekSections,
	weekStatus,
	weekView,
	type WeekView
} from '../../web/src/lib/order/week.ts';
import { weekHeading } from '../../web/src/lib/order/week-head.ts';
import { playersLead } from '../../web/src/lib/order/words.ts';
import { pillRank } from '../../web/src/lib/run/held-places.ts';
import { PAGE_NAME_WORDS, playersCrumb } from '../../web/src/lib/run/week-names.ts';
import { REPOSITORY } from './generated.ts';

export const RANKINGS_OUTPUT = 'shared/fixtures/parity/rankings.json';

/** The zone the fixture's kickoffs and reads are said in. */
const ZONE = 'America/Chicago';
/** The fixture clocks the order was read at, as their file names write them, with their instants. */
const CLOCKS = {
	week: { part: '2026-10-17T17-00-00Z', at: '2026-10-17T17:00:00.000Z' },
	sunday: { part: '2026-10-18T18-56-00Z', at: '2026-10-18T18:56:00.000Z' }
} as const;
type ClockName = keyof typeof CLOCKS;
/** The scoring the Players page names its kickers and defenses in: the default board's ("PPR"). */
const BOARD_SCORING = 'PPR';

/** Each order read the parity holds: its fixture file, the chip it was read for, its search. */
export const ORDER_CASES: readonly {
	name: string;
	clock: ClockName;
	part: string;
	chip: PlayersChip | null;
	q: string;
}[] = [
	{ name: 'all', clock: 'week', part: '', chip: null, q: '' },
	{ name: 'QB', clock: 'week', part: '-QB', chip: 'QB', q: '' },
	{ name: 'RB', clock: 'week', part: '-RB', chip: 'RB', q: '' },
	{ name: 'WR', clock: 'week', part: '-WR', chip: 'WR', q: '' },
	{ name: 'TE', clock: 'week', part: '-TE', chip: 'TE', q: '' },
	{ name: 'search', clock: 'week', part: '-q-wa', chip: null, q: 'wa' },
	{ name: 'WR-search', clock: 'week', part: '-WR-q-wa', chip: 'WR', q: 'wa' },
	{ name: 'all-sunday', clock: 'sunday', part: '', chip: null, q: '' }
];

/** Each week read the parity holds, with the search typed over it. */
export const WEEK_CASES: readonly {
	name: string;
	clock: ClockName;
	position: 'K' | 'DEF';
	q: string;
}[] = [
	{ name: 'K', clock: 'week', position: 'K', q: '' },
	{ name: 'DEF', clock: 'week', position: 'DEF', q: '' },
	{ name: 'DEF-search', clock: 'week', position: 'DEF', q: 'ti' },
	{ name: 'K-none', clock: 'week', position: 'K', q: 'zz' },
	{ name: 'K-sunday', clock: 'sunday', position: 'K', q: '' }
];

async function answer<T>(file: string): Promise<T> {
	const text = await readFile(join(REPOSITORY, 'shared/fixtures/inseason', file), 'utf8');
	return (JSON.parse(text) as { data: T }).data;
}

/** The player cell as the phone draws it: his name and its short form, his page, his face or club
 * mark, his club, his pill (StatusPill: his position and, across positions, his rank there, or the
 * list's word), his status chip, his game, the expected score and weather while it is to come. */
function playerCell(box: BoxRow): unknown {
	const pill =
		box.pill === null
			? null
			: {
					position: box.pill.position,
					rank:
						box.pill.rank === null
							? (box.status?.rank ?? null)
							: pillRank(box.status, box.pill.rank)
				};
	return {
		key: box.key,
		boardId: box.boardId,
		name: box.name,
		fit: fitName(box),
		slug: box.slug,
		mark: box.face.mark,
		club: box.club,
		position: box.position,
		pill:
			pill === null
				? null
				: pill.rank === null
					? pill.position
					: `${pill.position} ${String(pill.rank)}`,
		status: box.status === null ? null : { mark: box.status.mark, sits: box.status.sits },
		game: box.game,
		expected: box.expected,
		weather: box.weather
	};
}

/** The web's strip as the parity pins it: each cell's head and value, and whether it is the key. */
function cellsOf(cells: readonly StripCell[]): unknown[] {
	return cells.map((c) => ({
		head: c.head,
		value: c.value,
		key: c.key === true
	}));
}

/** The apps' folded line (B196 replaces it with the strip): the web's cells joined, the opponent's
 * rank under the apps' short head and left out on a bye. */
function appFoldedOf(cells: readonly StripCell[]): string {
	return cells
		.filter((c) => !(c.head === BOX.oppRank && c.ease === null))
		.map((c) => `${c.head === BOX.oppRank ? BOX.opp : c.head} ${c.value}`)
		.join(', ');
}

/** The apps' order line: every figure after Projected, the opponent's rank, Avg and Last. */
function appFolded(view: OrderView, rankBy: OrderAdvice['rank_by']): string {
	const rest = figureColumns(rankBy)
		.slice(1)
		.map((f) => figureCell(FIGURE_HEADS[f], view.figures[f]));
	return appFoldedOf([...rest, oppCell(view.box.evidence), ...formCells(view.box.evidence)]);
}

function orderRow(
	view: OrderView,
	rank: number,
	rankBy: OrderAdvice['rank_by'],
	week: number
): unknown {
	return {
		...(playerCell(view.box) as object),
		rank,
		place: view.place,
		bye: view.bye,
		week: boxNumber(view.week),
		total: boxNumber(view.figures.total),
		cells: cellsOf(stripCells(view, rankBy, week)),
		folded: appFolded(view, rankBy)
	};
}

function orderCase(advice: OrderAdvice, chip: PlayersChip | null, q: string, now: number): unknown {
	const views = advice.rows.map((row) => orderView(row, ZONE, chip === null, now, true));
	const filtered = q.trim().length >= MIN_SEARCH || chip !== null;
	return {
		lead: playersLead(true, false, advice.week) ?? null,
		hits: hitsWords(advice.total, filtered, advice.on_club),
		heads: {
			rank: ORDER.rank,
			week: weekHead(advice.week),
			total: ORDER.total
		},
		sections: orderSections(views, advice.week).map((section) => ({
			head: section.head,
			rows: section.rows.map((view) => {
				const index = views.indexOf(view);
				return orderRow(view, advice.rows[index]?.rank ?? 0, advice.rank_by, advice.week);
			})
		})),
		more: advice.total > advice.rows.length,
		basis: appBasis(drawnText(orderBasis(advice, null, ZONE, now), 'phone'))
	};
}

/** The phone's basis as the apps draw it: their folded line names the opponent's rank "Opp", so its
 * sentence is the short one where the web's strip heads it "Opp rank". Fails loudly when the web's
 * sentence is not there to swap, so the apps' basis never drifts in silence. */
function appBasis(text: string): string {
	if (!text.includes(OPP_PART))
		throw new Error(`rankings parity: the order's phone basis no longer says "${OPP_PART}"`);
	return text.replace(OPP_PART, OPP_PHONE);
}

function weekRow(view: WeekView): unknown {
	return {
		...(playerCell(view.box) as object),
		proj: boxNumber(view.box.proj),
		cells: cellsOf(weekStripCells(view)),
		folded: appFoldedOf(weekStripCells(view))
	};
}

function weekCase(advice: WeekOrderAdvice, q: string, now: number): unknown {
	const views = advice.rows.map((row) => weekView(row, ZONE, now));
	const shown = views.filter(weekSearch(q));
	const reader = { league: null, boardScoring: BOARD_SCORING };
	return {
		heading: weekHeading(advice.position, advice.week),
		status: weekStatus(advice),
		proj: landed(advice),
		none: shown.length === 0 && views.length > 0 ? weekNone(advice.position) : null,
		sections: weekSections(shown, advice.week, ZONE).map((section) => ({
			head: section.head,
			rows: section.rows.map(weekRow)
		})),
		basis: drawnText(weekBasis(advice, reader, ZONE, now), 'phone'),
		rules: rulesLeftOut(advice)
	};
}

export async function renderRankings(about: string): Promise<string> {
	const orders: Record<string, unknown> = {};
	for (const c of ORDER_CASES) {
		const clock = CLOCKS[c.clock];
		const advice = await answer<OrderAdvice>(`order${c.part}-${clock.part}.json`);
		orders[c.name] = {
			clock: clock.at,
			file: `order${c.part}-${clock.part}.json`,
			chip: c.chip,
			q: c.q,
			...(orderCase(advice, c.chip, c.q, Date.parse(clock.at)) as object)
		};
	}
	const weeks: Record<string, unknown> = {};
	for (const c of WEEK_CASES) {
		const clock = CLOCKS[c.clock];
		const file = `order-week-${c.position}-${clock.part}.json`;
		const advice = await answer<WeekOrderAdvice>(file);
		weeks[c.name] = {
			clock: clock.at,
			file,
			position: c.position,
			q: c.q,
			...(weekCase(advice, c.q, Date.parse(clock.at)) as object)
		};
	}
	return `${JSON.stringify(
		{
			about,
			zone: ZONE,
			names: {
				inSeason: PAGE_NAME_WORDS.rankings,
				before: PAGE_NAME_WORDS.players,
				crumb: playersCrumb(PAGE_NAME_WORDS.rankings)
			},
			leadBefore: playersLead(false, false, null) ?? null,
			chips: [ORDER.every, ...PLAYERS_CHIPS.map((p) => positionWord(p))],
			weekChips: PLAYERS_CHIPS.filter((p) => weekChip(p) !== null),
			orders,
			weeks
		},
		null,
		'\t'
	)}\n`;
}
