/** The clubs index, a club's page and the strength of schedule page, from clubs.json, schedule.json
 * and the default board. */
import { error } from '@sveltejs/kit';
import { carriesRange, rangeScale } from '#lib/run/derive.ts';
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
import { carriesGap } from '#lib/format/gap.ts';
import { adpDrafts } from '#lib/run/adp-drafts.ts';
import { boardBasis, type BasisPart } from '#lib/run/board-basis.ts';
import { rowFraming } from '#lib/run/row-framing.ts';
import type { Reach } from '#lib/run/reach.ts';
import {
	clubsLead,
	hardestFigure,
	hardestWords,
	playedWords,
	readWords,
	scheduleLead,
	STRENGTH_COLUMNS,
	STRENGTH_HEADS,
	strengthFigure,
	strengthView,
	winsBasis,
	type StrengthView
} from '#lib/run/strength-words.ts';
import { boardSeason } from '../board-season.ts';
import {
	adp,
	board,
	clubs,
	defaultFormat,
	designations,
	manifest,
	playedReach,
	schedule,
	seasonUnderway
} from '../run.ts';
import { boardStatuses, type BoardStatuses } from '../statuses.ts';

/** The share of opponents the schedule grid shades as the strongest: the top quarter of the league
 * (win totals move in halves, so ties can carry a few more). */
const STRONG_SHARE = 1 / 4;

const NOT_FOUND = 404;

/** A slate's strength as a page draws its figure (Lane 80): the run's tenth, its head with its rank
 * ("Rest of season strength, 3rd hardest of 32"), null in season on a run with no rest of season. */
export interface StrengthFigure {
	value: string;
	caption: string;
}

export interface ClubCard extends Club {
	strength: StrengthFigure | null;
	/** His best-ranked player on the default board, or null for a club with none. */
	lead: BoardRow | null;
	players: number;
}

export interface ClubsPage {
	format: Format;
	/** The page's lead, the strength's sentence in it when there is a strength to show. */
	lead: string;
	clubs: ClubCard[];
}

export interface ScheduleGame extends Game {
	/** The opponent's own value in the schedule's basis. */
	value: number;
	/** The game is in at the run (its state, or its week complete on a run from before): set back. */
	played: boolean;
}

/** A club's hero figures: its strength, headed, its read, and its rank as a figure. */
export interface ClubHero {
	value: string;
	caption: string;
	note: string;
	hardest: { figure: string; caption: string };
}

export interface ClubPage extends BoardStatuses {
	club: Club;
	format: Format;
	/** Null in season on a run with no rest of season: no figure is drawn. */
	hero: ClubHero | null;
	games: ScheduleGame[];
	/** "2026 schedule, weeks 1 to 5 and week 6's Thursday game are played, so faded". */
	scheduleCaption: string;
	schedule: Pick<Schedule, 'opponentBasis' | 'season'>;
	/** The club's players on the default board, each with his season so far once it is underway. */
	rows: BoardRowView[];
	/** The club's kickers, then its defense, in draft order, each with his status. */
	market: MarketRowView[];
	/** The rows' range scale, null where no row carries a range (in season): no Floor to ceiling. */
	scale: RangeScale | null;
	clubs: Club[];
	/** The page's basis, said once (Lane 66n): the opponents' figure and source, then the rows'. */
	basis: BasisPart[];
	/** The season is underway: the rows carry this season's GP and A game. */
	/** The screen shows the Gap: the board compares drafters with our rank and the run carries the
	 * figure on one of its rows (re-review N1). */
	gap: boolean;
	underway: boolean;
}

export interface SchedulePage {
	season: number;
	/** Every club's slate, hardest first by the strength shown, else in the clubs' order. */
	rows: ScheduleRow[];
	weeks: number[];
	/** What strength is, when it was read, and how the grid is ordered, shaded and faded. */
	lead: string;
	/** The strength column's head, null with no strength to show (no column is drawn). */
	strengthLabel: string | null;
	/** The last complete week, 0 before the first kickoff: the grid's week heads set back. */
	played: number;
}

/** The strength each slate shows, keyed by club (Lane 80). */
function viewsOf(loaded: Schedule, underway: boolean): Map<string, StrengthView> {
	const views = loaded.slates.flatMap((slate) => {
		const view = strengthView(slate, underway);
		return view === null ? [] : [[slate.abbr, view] as const];
	});
	return new Map(views);
}

/** A figure's caption: its head and its rank among the slates showing one. */
function strengthFigureOf(view: StrengthView | undefined, of: number): StrengthFigure | null {
	if (view === undefined) return null;
	return {
		value: strengthFigure(view.strength),
		caption: `${STRENGTH_HEADS[view.kind]}, ${hardestWords(view.rank, of)}`
	};
}

/** A game is set back once it is in at the run: final by its state, or, on a run from before the
 * states, its week complete. */
function isPlayed(game: Game, reach: Reach): boolean {
	return game.state === undefined ? game.week <= reach.complete : game.state === 'final';
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
	const [list, loaded, rows, capture, underway] = await Promise.all([
		clubs(),
		schedule(),
		board(format.id),
		designations(),
		seasonUnderway()
	]);
	const ordered = withStatuses(rows.rows, capture);
	const views = viewsOf(loaded, underway);
	const first = list.map((club) => views.get(club.abbr)).find((view) => view !== undefined);
	return {
		format,
		lead: clubsLead(format.label, first ?? null),
		clubs: list.map((club) => {
			const own = ordered.filter((row) => row.team === club.abbr);
			return {
				...club,
				strength: strengthFigureOf(views.get(club.abbr), views.size),
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
	const [list, loaded, rows, played, capture, sources, run, underway] = await Promise.all([
		clubs(),
		schedule(),
		board(format.id),
		playedReach(),
		designations(),
		adp(),
		manifest(),
		seasonUnderway()
	]);
	const club = list.find((candidate) => candidate.abbr.toLowerCase() === abbr);
	if (!club) error(NOT_FOUND, 'No such club.');
	const slate = slateOf(loaded, club.abbr);
	const views = viewsOf(loaded, underway);
	const view = views.get(club.abbr);
	const fadedWords = playedWords(played);
	const own = withStatuses(rows.rows, capture).filter((row) => row.team === club.abbr);
	const { rows: seasoned, reach } = await boardSeason(format, own);
	const adpBasis = adpDrafts(sources.sources, format.id);
	const showsGap = rowFraming(format).compare && carriesGap(seasoned);
	// His kickers and his defense, in draft order (Lane 66m).
	const market = MARKET_POSITIONS.flatMap((position) =>
		withStatuses(marketAt(rows.market, position), capture)
			.filter((row) => row.team === club.abbr)
			.map(withFace)
	);
	return {
		club,
		format,
		hero:
			view === undefined
				? null
				: {
						value: strengthFigure(view.strength),
						caption: STRENGTH_HEADS[view.kind],
						note: readWords(view),
						hardest: hardestFigure(view.rank, views.size)
					},
		games: slate.games.map((game) => ({
			...game,
			value: opponentValue(loaded, game.opponent),
			played: isPlayed(game, played)
		})),
		scheduleCaption: `${String(loaded.season)} schedule${fadedWords === '' ? '' : `, ${fadedWords}`}`,
		schedule: { opponentBasis: loaded.opponentBasis, season: loaded.season },
		rows: seasoned,
		market,
		scale: carriesRange(own) ? rangeScale(own) : null,
		clubs: list,
		basis: [
			{ text: winsBasis(loaded.opponentBasis), phone: true },
			...boardBasis({
				format,
				season: run.season,
				order: 'board',
				adpBasis,
				gap: showsGap,
				reach
			})
		],
		gap: showsGap,
		underway: reach !== null,
		...boardStatuses([...seasoned, ...market], capture, format)
	};
}

/** The slates in the grid's order: hardest first by the strength shown, else in the clubs' order. */
function gridOrder(loaded: Schedule, views: ReadonlyMap<string, StrengthView>): Slate[] {
	if (views.size === 0) return [...loaded.slates].sort((a, b) => a.abbr.localeCompare(b.abbr));
	const rank = (slate: Slate): number => views.get(slate.abbr)?.rank ?? Infinity;
	return [...loaded.slates].sort((a, b) => rank(a) - rank(b) || a.abbr.localeCompare(b.abbr));
}

export async function schedulePage(): Promise<SchedulePage> {
	const format = await defaultFormat();
	const [loaded, list, rows, played, underway] = await Promise.all([
		schedule(),
		clubs(),
		board(format.id),
		playedReach(),
		seasonUnderway()
	]);
	const lastWeek = Math.max(
		...loaded.slates.flatMap((slate) => slate.games.map((game) => game.week))
	);
	const weeks = Array.from({ length: lastWeek }, (_, i) => i + 1);
	const strong = strongFloor(Object.values(loaded.opponentValues));
	const views = viewsOf(loaded, underway);
	const slates = gridOrder(loaded, views);
	const first = slates.map((slate) => views.get(slate.abbr)).find((view) => view !== undefined);
	return {
		season: loaded.season,
		weeks,
		lead: scheduleLead(
			first ?? null,
			{ count: strong.count, atLeast: fixed(strong.floor, 1) },
			played
		),
		strengthLabel: first === undefined ? null : STRENGTH_COLUMNS[first.kind],
		played: played.complete,
		rows: slates.map((slate) => {
			const club = list.find((candidate) => candidate.abbr === slate.abbr);
			const lead = rows.rows.find((row) => row.team === slate.abbr);
			const view = views.get(slate.abbr);
			return {
				abbr: slate.abbr,
				name: club ? `${club.city} ${club.nickname}` : slate.abbr,
				href: links.club(slate.abbr),
				face: lead ? { src: lead.headshot, name: lead.name } : null,
				rank: view?.rank ?? null,
				strength: view === undefined ? null : strengthFigure(view.strength),
				cells: weeks.map((week) => {
					const game = slate.games.find((candidate) => candidate.week === week);
					if (!game) {
						return {
							week,
							opponent: null,
							home: false,
							value: '',
							hard: false,
							played: week <= played.complete
						};
					}
					const value = opponentValue(loaded, game.opponent);
					return {
						week,
						opponent: game.opponent,
						home: game.home,
						value: fixed(value, 1),
						hard: value >= strong.floor,
						played: isPlayed(game, played)
					};
				})
			};
		})
	};
}
