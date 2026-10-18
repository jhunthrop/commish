/** The clubs index, a club's page and the strength of schedule page, from clubs.json, schedule.json
 * and the default board. */
import { error } from '@sveltejs/kit';
import { rangeScale } from '#lib/run/derive.ts';
import type {
	BoardRow,
	BoardRowView,
	Club,
	Format,
	Game,
	MarketRowView,
	Schedule,
	Slate
} from '#lib/run/schema.ts';
import { MARKET_POSITIONS, marketAt } from '#lib/run/market.ts';
import { withFace } from '#lib/site/market.ts';
import { fixed } from '#lib/format/number.ts';
import { links } from '#lib/site/links.ts';
import type { ScheduleRow } from '#lib/ui/schedule-grid.ts';
import type { RangeScale } from '#lib/types/player.ts';
import { withStatuses } from '#lib/run/board-status.ts';
import { leadOf } from '#lib/run/held-places.ts';
import { adpDrafts } from '#lib/run/adp-drafts.ts';
import { boardBasis, type BasisPart } from '#lib/run/board-basis.ts';
import { rowFraming } from '#lib/run/row-framing.ts';
import { winsBasis } from '#lib/run/strength-words.ts';
import { boardSeason } from '../board-season.ts';
import {
	adp,
	board,
	clubs,
	defaultFormat,
	designations,
	manifest,
	playedThrough,
	schedule
} from '../run.ts';
import { boardStatuses, type BoardStatuses } from '../statuses.ts';

/** The share of opponents the schedule grid shades as the strongest: the top quarter of the league
 * (win totals move in halves, so ties can carry a few more). */
const STRONG_SHARE = 1 / 4;

const NOT_FOUND = 404;

export interface ClubCard extends Club {
	slate: Slate;
	/** His best-ranked player on the default board, or null for a club with none. */
	lead: BoardRow | null;
	players: number;
}

export interface ClubsPage {
	format: Format;
	/** A slate's strength as its caption names it. */
	unit: string;
	clubs: ClubCard[];
}

export interface ScheduleGame extends Game {
	/** The opponent's own value in the schedule's basis. */
	value: number;
}

export interface ClubPage extends BoardStatuses {
	club: Club;
	format: Format;
	slate: Slate;
	games: ScheduleGame[];
	schedule: Pick<Schedule, 'opponentBasis' | 'season'>;
	/** The club's players on the default board, each with his season so far once it is underway. */
	rows: BoardRowView[];
	/** The club's kickers, then its defense, in draft order, each with his status. */
	market: MarketRowView[];
	scale: RangeScale | null;
	clubs: Club[];
	/** The last week played, 0 before the first kickoff: the schedule sets those weeks back. */
	played: number;
	/** The page's basis, said once (Lane 66n): the opponents' figure and source, then the rows'. */
	basis: BasisPart[];
	/** The season is underway: the rows carry this season's GP and A game. */
	underway: boolean;
}

export interface SchedulePage {
	season: number;
	/** Every club's slate, hardest first, as the grid prints it. */
	rows: ScheduleRow[];
	weeks: number[];
	/** How strength is measured, its unit, and when its inputs were read, from the run. */
	method: string;
	unit: string;
	window: Slate['window'];
	/** What one opponent's number is: "Published season win total". */
	opponentBasis: string;
	/** How many opponents are shaded as the strongest, and the number they reach. */
	strong: { count: number; atLeast: string };
	/** The last week played, 0 before the first kickoff: the grid sets those weeks back. */
	played: number;
}

/** The opponent values that count as the strongest: the top share of the league, ties kept in. */
function strongFloor(values: readonly number[]): { count: number; floor: number } {
	const sorted = [...values].sort((a, b) => b - a);
	const floor = sorted[Math.max(0, Math.ceil(sorted.length * STRONG_SHARE) - 1)] ?? Infinity;
	return { count: sorted.filter((value) => value >= floor).length, floor };
}

/** An opponent's value. The run's schema guarantees one for every opponent on a slate. */
function opponentValue(loaded: Schedule, abbr: string): number {
	const value = loaded.opponentValues[abbr];
	if (value === undefined) throw new Error(`schedule.json has no value for ${abbr}.`);
	return value;
}

function slateOf(loaded: Schedule, abbr: string): Slate {
	const slate = loaded.slates.find((candidate) => candidate.abbr === abbr);
	if (!slate) throw new Error(`schedule.json has no slate for ${abbr}.`);
	return slate;
}

export async function clubsPage(): Promise<ClubsPage> {
	const format = await defaultFormat();
	const [list, loaded, rows, capture] = await Promise.all([
		clubs(),
		schedule(),
		board(format.id),
		designations()
	]);
	const ordered = withStatuses(rows.rows, capture);
	return {
		format,
		unit: loaded.unit,
		clubs: list.map((club) => {
			const own = ordered.filter((row) => row.team === club.abbr);
			return {
				...club,
				slate: slateOf(loaded, club.abbr),
				// Never a player on a season-long list, whose rank assumes he plays (Lane 63).
				lead: leadOf(own),
				players: own.length
			};
		})
	};
}

export async function clubEntries(): Promise<{ abbr: string }[]> {
	return (await clubs()).map((club) => ({ abbr: club.abbr.toLowerCase() }));
}

export async function clubPage(abbr: string): Promise<ClubPage> {
	const format = await defaultFormat();
	const [list, loaded, rows, played, capture, sources, run] = await Promise.all([
		clubs(),
		schedule(),
		board(format.id),
		playedThrough(),
		designations(),
		adp(),
		manifest()
	]);
	const club = list.find((candidate) => candidate.abbr.toLowerCase() === abbr);
	if (!club) error(NOT_FOUND, 'No such club.');
	const slate = slateOf(loaded, club.abbr);
	const own = withStatuses(rows.rows, capture).filter((row) => row.team === club.abbr);
	const { rows: seasoned, reach } = await boardSeason(format, own);
	const adpBasis = adpDrafts(sources.sources, format.id);
	// His kickers and his defense, in draft order (Lane 66m).
	const market = MARKET_POSITIONS.flatMap((position) =>
		withStatuses(marketAt(rows.market, position), capture)
			.filter((row) => row.team === club.abbr)
			.map(withFace)
	);
	return {
		club,
		format,
		slate,
		games: slate.games.map((game) => ({
			...game,
			value: opponentValue(loaded, game.opponent)
		})),
		schedule: { opponentBasis: loaded.opponentBasis, season: loaded.season },
		rows: seasoned,
		market,
		scale: own.length > 0 ? rangeScale(own) : null,
		clubs: list,
		played,
		basis: [
			{ text: winsBasis(loaded.opponentBasis), phone: true },
			...boardBasis({
				format,
				season: run.season,
				order: 'board',
				adpBasis,
				gap: rowFraming(format).compare,
				reach
			})
		],
		underway: reach !== null,
		...boardStatuses([...seasoned, ...market], capture, format)
	};
}

export async function schedulePage(): Promise<SchedulePage> {
	const format = await defaultFormat();
	const [loaded, list, rows, played] = await Promise.all([
		schedule(),
		clubs(),
		board(format.id),
		playedThrough()
	]);
	const lastWeek = Math.max(
		...loaded.slates.flatMap((slate) => slate.games.map((game) => game.week))
	);
	const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);
	const strong = strongFloor(Object.values(loaded.opponentValues));
	const slates = [...loaded.slates].sort((a, b) => a.rank - b.rank);
	const [first] = slates;
	if (!first) throw new Error('schedule.json has no slates.');
	return {
		season: loaded.season,
		weeks,
		method: first.method,
		unit: loaded.unit,
		window: first.window,
		opponentBasis: loaded.opponentBasis,
		strong: { count: strong.count, atLeast: fixed(strong.floor, 1) },
		played,
		rows: slates.map((slate) => {
			const club = list.find((candidate) => candidate.abbr === slate.abbr);
			const lead = rows.rows.find((row) => row.team === slate.abbr);
			return {
				abbr: slate.abbr,
				name: club ? `${club.city} ${club.nickname}` : slate.abbr,
				href: links.club(slate.abbr),
				face: lead ? { src: lead.headshot, name: lead.name } : null,
				rank: slate.rank,
				strength: fixed(slate.strength, 2),
				cells: weeks.map((week) => {
					const game = slate.games.find((candidate) => candidate.week === week);
					if (!game) return { week, opponent: null, home: false, value: '', hard: false };
					const value = opponentValue(loaded, game.opponent);
					return {
						week,
						opponent: game.opponent,
						home: game.home,
						value: fixed(value, 1),
						hard: value >= strong.floor
					};
				})
			};
		})
	};
}
