/** The clubs index, a club's schedule and the strength of schedule grid as pure views of the run's
 * clubs.json, schedule.json and default board (Lane 199): what server/pages/clubs.ts builds its pages
 * from, and what the apps' ports are held to (shared/fixtures/parity/reference.json). No link and no
 * read here, so a script can build every page's words from a fixture run. */
import { fixed } from '#lib/format/number.ts';
import type { ScheduleCell } from '#lib/ui/schedule-grid.ts';
import { leadOf } from './held-places.ts';
import type { Reach } from './reach.ts';
import type { BoardRow, Club, Game, PlayerStatus, Schedule, Slate } from './schema.ts';
import {
	STRENGTH_COLUMNS,
	STRENGTH_HEADS,
	clubsLead,
	hardestFigure,
	hardestWords,
	playedWords,
	readWords,
	scheduleLead,
	strengthFigure,
	strengthView,
	type StrengthView
} from './strength-words.ts';

/** The share of opponents the schedule grid shades as the strongest: the top quarter of the league
 * (win totals move in halves, so ties can carry a few more). */
export const STRONG_SHARE = 1 / 4;

/** A slate's strength as a page draws its figure (Lane 80): the run's tenth, its head with its rank
 * ("Rest of season strength, 3rd hardest of 32"), null in season on a run with no rest of season. */
export interface StrengthFigure {
	value: string;
	caption: string;
}

/** A club on the clubs index: its strength, its lead player and how many of its players our board
 * ranks. */
export type ClubCardView<R> = Club & {
	strength: StrengthFigure | null;
	/** His best-ranked player on the default board, or null for a club with none. */
	lead: R | null;
	players: number;
};

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

/** A club's schedule as its page draws it: the hero's figures, every game and the table's caption. */
export interface ClubSchedule {
	/** Null in season on a run with no rest of season: no figure is drawn. */
	hero: ClubHero | null;
	games: ScheduleGame[];
	/** "2026 schedule, weeks 1 to 5 and week 6's Thursday game are played, so faded". */
	scheduleCaption: string;
}

/** One club's row of the grid with no link: the page adds its club's address. */
export interface ScheduleGridRow {
	abbr: string;
	name: string;
	face: { src: string; name: string } | null;
	rank: number | null;
	strength: string | null;
	cells: ScheduleCell[];
}

export interface ScheduleGrid {
	season: number;
	/** Every club's slate, hardest first by the strength shown, else in the clubs' order. */
	rows: ScheduleGridRow[];
	weeks: number[];
	/** What strength is, when it was read, and how the grid is ordered, shaded and faded. */
	lead: string;
	/** The strength column's head, null with no strength to show (no column is drawn). */
	strengthLabel: string | null;
	/** The last complete week, 0 before the first kickoff: the grid's week heads set back. */
	played: number;
}

/** The strength each slate shows, keyed by club (Lane 80). */
export function viewsOf(loaded: Schedule, underway: boolean): Map<string, StrengthView> {
	const views = loaded.slates.flatMap((slate) => {
		const view = strengthView(slate, underway);
		return view === null ? [] : [[slate.abbr, view] as const];
	});
	return new Map(views);
}

/** A figure's caption: its head and its rank among the slates showing one. */
export function strengthFigureOf(view: StrengthView | undefined, of: number): StrengthFigure | null {
	if (view === undefined) return null;
	return {
		value: strengthFigure(view.strength),
		caption: `${STRENGTH_HEADS[view.kind]}, ${hardestWords(view.rank, of)}`
	};
}

/** A game is set back once it is in at the run: final by its state, or, on a run from before the
 * states, its week complete. */
export function isPlayed(game: Pick<Game, 'week' | 'state'>, reach: Reach): boolean {
	return game.state === undefined ? game.week <= reach.complete : game.state === 'final';
}

/** The opponent values that count as the strongest: the top share of the league, ties kept in. */
export function strongFloor(values: readonly number[]): { count: number; floor: number } {
	const sorted = [...values].sort((a, b) => b - a);
	const floor = sorted[Math.max(0, Math.ceil(sorted.length * STRONG_SHARE) - 1)] ?? Infinity;
	return { count: sorted.filter((value) => value >= floor).length, floor };
}

/** An opponent's value. The run's schema guarantees one for every opponent on a slate. */
export function opponentValue(loaded: Schedule, abbr: string): number {
	const value = loaded.opponentValues[abbr];
	if (value === undefined) throw new Error(`schedule.json has no value for ${abbr}.`);
	return value;
}

export function slateOf(loaded: Schedule, abbr: string): Slate {
	const slate = loaded.slates.find((candidate) => candidate.abbr === abbr);
	if (!slate) throw new Error(`schedule.json has no slate for ${abbr}.`);
	return slate;
}

/** The clubs index: its lead and every club's card, from the default board's rows with their
 * statuses placed (board-status.ts withStatuses). */
export function clubCards<R extends BoardRow & { status?: PlayerStatus }>(
	list: readonly Club[],
	loaded: Schedule,
	ordered: readonly R[],
	formatLabel: string,
	underway: boolean
): { lead: string; clubs: ClubCardView<R>[] } {
	const views = viewsOf(loaded, underway);
	const first = list.map((club) => views.get(club.abbr)).find((view) => view !== undefined);
	return {
		lead: clubsLead(formatLabel, first ?? null),
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

/** A club's hero, games and the schedule's caption. */
export function clubSchedule(
	club: Club,
	loaded: Schedule,
	played: Reach,
	underway: boolean
): ClubSchedule {
	const slate = slateOf(loaded, club.abbr);
	const views = viewsOf(loaded, underway);
	const view = views.get(club.abbr);
	const fadedWords = playedWords(played);
	return {
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
		scheduleCaption: `${String(loaded.season)} schedule${fadedWords === '' ? '' : `, ${fadedWords}`}`
	};
}

/** The slates in the grid's order: hardest first by the strength shown, else in the clubs' order. */
function gridOrder(loaded: Schedule, views: ReadonlyMap<string, StrengthView>): Slate[] {
	if (views.size === 0) return [...loaded.slates].sort((a, b) => a.abbr.localeCompare(b.abbr));
	const rank = (slate: Slate): number => views.get(slate.abbr)?.rank ?? Infinity;
	return [...loaded.slates].sort((a, b) => rank(a) - rank(b) || a.abbr.localeCompare(b.abbr));
}

/** A week's cell for a club: the opponent and his value, shaded among the strongest, set back once
 * played; the bye with no opponent. */
function cellOf(
	loaded: Schedule,
	slate: Slate,
	week: number,
	strong: number,
	played: Reach
): ScheduleCell {
	const game = slate.games.find((candidate) => candidate.week === week);
	if (!game) {
		return { week, opponent: null, home: false, value: '', hard: false, played: week <= played.complete };
	}
	const value = opponentValue(loaded, game.opponent);
	return {
		week,
		opponent: game.opponent,
		home: game.home,
		value: fixed(value, 1),
		hard: value >= strong,
		played: isPlayed(game, played)
	};
}

/** The strength of schedule grid: every club by week, hardest first, the strongest opponents
 * shaded and the games in set back. */
export function scheduleGrid(
	loaded: Schedule,
	list: readonly Club[],
	rows: readonly BoardRow[],
	played: Reach,
	underway: boolean
): ScheduleGrid {
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
			const lead = rows.find((row) => row.team === slate.abbr);
			const view = views.get(slate.abbr);
			return {
				abbr: slate.abbr,
				name: club ? `${club.city} ${club.nickname}` : slate.abbr,
				face: lead ? { src: lead.headshot, name: lead.name } : null,
				rank: view?.rank ?? null,
				strength: view === undefined ? null : strengthFigure(view.strength),
				cells: weeks.map((week) => cellOf(loaded, slate, week, strong.floor, played))
			};
		})
	};
}
