/** The Waivers screen's position panel (Lane 291): one card a position the league starts, the member's
 * rank there among the league's teams with his figure against the median team's and the profile's need
 * mark, opening on its ranked list: his own players first, then the best free agents there, each free
 * agent drawn with the table's Beats and the table's verb (one rule, the table's: poolRows). A toggle
 * reads the figures for the rest of the season or for this week. Pure, tested in positions.test.ts. */
import type { WaiverAdvice, WaiverRow } from '../inseason/api.ts';
import type { components } from '#lib/api/types.ts';
import { BOX, boxNumber, positionWord } from './box.ts';
import { beatsPlace, beatsWord, poolRows, shortName, WAIVERS, type PoolRow } from './waivers.ts';

type WaiverPositionCard = components['schemas']['WaiverPositionCard'];
type WaiverStanding = components['schemas']['WaiverStanding'];

/** The figures the panel reads: the rest of the season (the default) or this week's Proj. */
export type PanelMode = 'season' | 'week';

/** Every word the panel prints, in one place for the copy guard. */
export const PANEL = {
	label: 'Your positions',
	season: 'Rest of season',
	week: 'This week',
	need: 'Need',
	median: 'median',
	rank: 'rank',
	of: 'of',
	yours: 'Yours',
	free: 'Free',
	noneFree: 'No free agent we list plays here.',
	/** The panel says what its rank is, once, under the cards. */
	explain: {
		season: "Rank is your starters' rest of season at the position against the league's.",
		week: "Rank is your starters' Proj this week at the position against the league's."
	},
	/** The need mark's meaning, its real measure (the position's rest of season against the median
	 * team's), said after the rank's line where a Need is drawn (Lane 291 re-review N2). */
	needSays: "Need: your rest of season at this position is under the league's median.",
	/** One line where a Need is drawn: the Trades screen reads needs another way. */
	tradesNeeds: "The Trades screen's needs are by starting slot."
} as const;

/** One player on a card's ranked list. */
export interface PanelEntry {
	key: string;
	/** His short name, as the strip and Beats print a second mention. */
	name: string;
	full: string;
	team: string;
	/** Starter or Bench for the member's, Free for a free agent. */
	mark: string;
	/** The toggle's figure: his rest-of-season points, or this week's Proj. */
	figure: string;
	/** A free agent's row as the table draws it (its Beats and its verb's input); null for the member's. */
	pool: PoolRow | null;
	/** The words of his Beats cell ("Dart, Bench, +0.3 Gain"), null for the member's own. */
	beats: string | null;
}

/** One card, as the panel draws it. */
export interface PanelCard {
	key: string;
	position: WaiverPositionCard['position'];
	word: string;
	/** "RB rank 2 of 12", or "RB --" where the figure is not read. */
	rank: string;
	/** The same after the position: "rank 2 of 12", or "--". */
	place: string;
	/** The member's figure and the median team's, each a tenth or --. */
	figure: string;
	median: string;
	need: boolean;
	/** His place, null where the mode has no figure. */
	standing: number | null;
	teams: number;
	mine: PanelEntry[];
	free: PanelEntry[];
}

/** The standing the mode reads. */
function standingOf(card: WaiverPositionCard, mode: PanelMode): WaiverStanding | null {
	return mode === 'season' ? card.rest_of_season : card.week;
}

/** "rank 2 of 12", the card's words after its position; "--" with no figure. */
export function placeWords(standing: WaiverStanding | null, teams: number): string {
	if (standing === null) return BOX.none;
	return `${PANEL.rank} ${String(standing.rank)} ${PANEL.of} ${String(teams)}`;
}

/** "RB rank 2 of 12", the walk's card head; "RB --" with no figure. */
export function rankWords(word: string, standing: WaiverStanding | null, teams: number): string {
	return `${word} ${placeWords(standing, teams)}`;
}

/** A free agent's Beats cell in words, as the table's cell reads: the name and his place where he
 * beats one of the member's, then the Gain ("Dart, Bench, +0.3 Gain"; the bare "0.0" on a row that
 * gains nothing, which names no one). */
export function beatsWords(pool: PoolRow): string {
	const { who } = pool.beats;
	const gain = beatsWord(pool.beats);
	return who === null ? gain : `${who.name}, ${beatsPlace(who)}, ${gain}`;
}

function entryOf(
	line: WaiverRow['add'],
	points: number | null,
	mode: PanelMode,
	mark: string
): Omit<PanelEntry, 'pool' | 'beats' | 'key'> {
	return {
		name: shortName(line.player.name),
		full: line.player.name,
		team: line.player.team,
		mark,
		figure: boxNumber(mode === 'season' ? points : line.week_projection)
	};
}

/** The figure an entry sorts by in the mode, none last. */
function sortFigure(line: WaiverRow['add'], points: number | null, mode: PanelMode): number {
	const v = mode === 'season' ? points : line.week_projection;
	return v ?? Number.NEGATIVE_INFINITY;
}

function byFigure<T>(items: readonly T[], figure: (item: T) => number): T[] {
	return [...items].sort((a, b) => figure(b) - figure(a));
}

/** A card's ranked list: the member's players, then the free agents, each by the mode's figure. */
function entriesOf(
	card: WaiverPositionCard,
	advice: Pick<WaiverAdvice, 'pickups' | 'roster'>,
	mode: PanelMode,
	zone: string,
	now: number
): Pick<PanelCard, 'mine' | 'free'> {
	const mine = byFigure(card.mine, (m) => sortFigure(m.line, m.rest_of_season_points, mode)).map(
		(m): PanelEntry => ({
			...entryOf(
				m.line,
				m.rest_of_season_points,
				mode,
				(mode === 'season' ? m.starter : m.starts_this_week) ? WAIVERS.starter : WAIVERS.bench
			),
			key: `mine:${m.line.player.host_id}`,
			pool: null,
			beats: null
		})
	);
	// This week lists the week's own best five by Proj (review M1); an older answer re-sorts its five.
	const listed = mode === 'week' ? (card.available_week ?? card.available) : card.available;
	const free = byFigure(listed, (f) => sortFigure(f.row.add, f.rest_of_season_points, mode));
	const pools = poolRows(
		{ rows: free.map((f) => f.row), pickups: advice.pickups, roster: advice.roster },
		zone,
		now
	);
	return {
		mine,
		// poolRows keeps its rows' order, one each.
		free: free.flatMap((f, i): PanelEntry[] => {
			const pool = pools[i];
			if (pool === undefined) return [];
			return [
				{
					...entryOf(f.row.add, f.rest_of_season_points, mode, PANEL.free),
					key: `free:${pool.key}`,
					pool,
					beats: beatsWords(pool)
				}
			];
		})
	};
}

/** The panel's cards from the answer in the mode; empty from an answer without the panel. */
export function panelCards(
	advice: Pick<WaiverAdvice, 'positions' | 'pickups' | 'roster'>,
	mode: PanelMode,
	zone: string,
	now: number
): PanelCard[] {
	return (advice.positions ?? []).map((card) => {
		const standing = standingOf(card, mode);
		const word = positionWord(card.position);
		return {
			key: card.position,
			position: card.position,
			word,
			rank: rankWords(word, standing, card.teams),
			place: placeWords(standing, card.teams),
			figure: boxNumber(standing?.points ?? null),
			median: boxNumber(standing?.median ?? null),
			// The need is the rest of the season's (the profile's): not marked on this week's figures.
			need: card.need && mode === 'season',
			standing: standing?.rank ?? null,
			teams: card.teams,
			...entriesOf(card, advice, mode, zone, now)
		};
	});
}

/** Whether the answer reads this week's figures: the toggle is drawn only then. */
export function panelHasWeek(advice: Pick<WaiverAdvice, 'positions'>): boolean {
	return (advice.positions ?? []).some((c) => c.week !== null);
}

/** The panel's line under the cards: what the rank is, and where a Need is drawn what it is and how
 * the Trades screen's needs differ. */
export function panelExplain(mode: PanelMode, cards: readonly Pick<PanelCard, 'need'>[]): string {
	const rank = PANEL.explain[mode];
	return cards.some((c) => c.need) ? `${rank} ${PANEL.needSays} ${PANEL.tradesNeeds}` : rank;
}
