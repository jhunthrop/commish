/** The clubs index, a club's page and the strength of schedule page, from clubs.json, schedule.json
 * and the default board. Their words and figures are the run's pure views (run/schedule-view.ts),
 * which the apps' ports are held to; this module reads the run and adds the links. */
import { error } from '@sveltejs/kit';
import { carriesRange, rangeScale } from '#lib/run/derive.ts';
import type {
	BoardRow,
	BoardRowView,
	Club,
	Format,
	MarketRowView,
	PlayerStatus,
	Schedule
} from '#lib/run/schema.ts';
import { MARKET_POSITIONS, marketAt } from '#lib/run/market.ts';
import { withFace } from '#lib/site/market.ts';
import { links } from '#lib/site/links.ts';
import type { ScheduleRow } from '#lib/ui/schedule-grid.ts';
import type { RangeScale } from '#lib/types/player.ts';
import { withStatuses } from '#lib/run/board-status.ts';
import { carriesGap } from '#lib/format/gap.ts';
import { adpDrafts } from '#lib/run/adp-drafts.ts';
import { boardBasis, type BasisPart } from '#lib/run/board-basis.ts';
import { rowFraming } from '#lib/run/row-framing.ts';
import {
	clubCards,
	clubSchedule,
	scheduleGrid,
	type ClubCardView,
	type ClubSchedule,
	type ScheduleGrid
} from '#lib/run/schedule-view.ts';
import { currentWeek, type CurrentWeek } from '#lib/run/schedule-state.ts';
import { winsBasis } from '#lib/run/strength-words.ts';
import type { Reach } from '#lib/run/reach.ts';
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

export type { ClubHero, ScheduleGame, StrengthFigure } from '#lib/run/schedule-view.ts';

const NOT_FOUND = 404;

/** How many of a club's first players on the board a card carries for its lead at the order's clock
 * (Lane 220): a club's players all lose the same games as its games kick off, so its lead at the clock
 * is among its first few on the run. The index reads the order's first 400 rows (ORDER_MAX_ROWS), every
 * available player before any listed one (api order.go playingFirst): on a board of more than 400
 * ranked players a listed player in a club's first three could fall outside the read, and the index
 * then keeps the run's leads, every one (review L5). */
export const CLUB_LEAD_POOL = 3;

/** A club card's player as the card draws him and the order places him (review L4): no more of the
 * board row than that. */
export type LeadRow = Pick<
	BoardRow,
	| 'id'
	| 'slug'
	| 'name'
	| 'position'
	| 'positionRank'
	| 'team'
	| 'headshot'
	| 'ourRank'
	| 'projected'
	| 'vor'
	| 'vorRound'
	| 'gap'
> & { status?: PlayerStatus };

export type ClubCard = Omit<ClubCardView<BoardRow>, 'lead'> & {
	lead: LeadRow | null;
	/** In season, the club's first players on the board, the lead's pool at the order's clock; none
	 * before the season, when the leads are the run's alone. */
	pool: LeadRow[];
};

function leadRow(row: BoardRow & { status?: PlayerStatus }): LeadRow {
	return {
		id: row.id,
		slug: row.slug,
		name: row.name,
		position: row.position,
		positionRank: row.positionRank,
		team: row.team,
		headshot: row.headshot,
		ourRank: row.ourRank,
		projected: row.projected,
		vor: row.vor,
		vorRound: row.vorRound,
		gap: row.gap ?? null,
		...(row.status === undefined ? {} : { status: row.status })
	};
}

export interface ClubsPage {
	format: Format;
	/** The run ranks the rest of the season: the cards' leads are read again at the order's clock. */
	restOfSeason: boolean;
	/** The page's lead, the strength's sentence in it when there is a strength to show. */
	lead: string;
	clubs: ClubCard[];
}

export interface ClubPage extends BoardStatuses, ClubSchedule {
	club: Club;
	format: Format;
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
	/** The screen shows the Gap: the board compares drafters with our rank and the run carries the
	 * figure on one of its rows (re-review N1). */
	gap: boolean;
	/** The season is underway: the rows carry this season's GP and A game. */
	underway: boolean;
}

export interface SchedulePage extends Omit<ScheduleGrid, 'rows'> {
	/** Every club's slate, hardest first by the strength shown, else in the clubs' order. */
	rows: ScheduleRow[];
}

/** The week whose games the schedule says the state of, as the run read them (Lane 223, B187). */
function currentOf(
	loaded: Schedule,
	played: Reach,
	underway: boolean,
	readAt: string
): CurrentWeek | null {
	const games = loaded.slates.flatMap((slate) => slate.games);
	return currentWeek(games, played, underway, readAt);
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
	const cards = clubCards(list, loaded, ordered, format.label, underway);
	const restOfSeason = format.rosFromWeek !== undefined;
	return {
		format,
		restOfSeason,
		lead: cards.lead,
		clubs: cards.clubs.map((card) => ({
			...card,
			lead: card.lead === null ? null : leadRow(card.lead),
			pool: restOfSeason
				? ordered
						.filter((row) => row.team === card.abbr)
						.slice(0, CLUB_LEAD_POOL)
						.map(leadRow)
				: []
		}))
	};
}

export async function clubEntries(): Promise<{ abbr: string }[]> {
	return (await clubs()).map((club) => ({ abbr: club.abbr.toLowerCase() }));
}

export async function clubPage(abbr: string, now: number): Promise<ClubPage> {
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
		...clubSchedule(club, loaded, played, underway, currentOf(loaded, played, underway, run.runAt)),
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
		...boardStatuses([...seasoned, ...market], capture, format, now)
	};
}

export async function schedulePage(): Promise<SchedulePage> {
	const format = await defaultFormat();
	const [loaded, list, rows, played, underway, run] = await Promise.all([
		schedule(),
		clubs(),
		board(format.id),
		playedReach(),
		seasonUnderway(),
		manifest()
	]);
	const current = currentOf(loaded, played, underway, run.runAt);
	const grid = scheduleGrid(loaded, list, rows.rows, played, underway, current);
	return { ...grid, rows: grid.rows.map((row) => ({ ...row, href: links.club(row.abbr) })) };
}
