/** The Waivers screen's position cards as its navigation (Lane 305): an All card, then a card a
 * position the league starts, each with the member's rank there, his figure against the median
 * team's and the Need mark (Lane 291's panel figures, positions.ts). The screen opens on the weakest
 * Need; a chosen position sets the member's players there against the free agents there in the
 * table's columns. One toggle reads the cards and the list for the rest of the season or this week.
 * Pure, tested in position-nav.test.ts. */
import type { components } from '#lib/api/types.ts';
import type { WaiverAdvice, WaiverPosition } from '../inseason/api.ts';
import { boxNumber, boxRow, positionWord, type BoxRow } from './box.ts';
import { PANEL, placeWords, type PanelMode } from './positions.ts';
import { DEFAULT_SORT, WAIVERS, type Sort } from './waivers.ts';

type WaiverPositionCard = components['schemas']['WaiverPositionCard'];
type WaiverStanding = components['schemas']['WaiverStanding'];

/** A card's key: a position, or every position. */
export type NavKey = WaiverPosition | 'ALL';
export const ALL = 'ALL' as const;

/** Every word the cards and the comparison print beyond the panel's own (PANEL), for the copy guard. */
export const NAV = {
	all: 'All',
	freeAgents: 'free agents',
	beat: 'beat yours',
	every: 'Every position',
	pickup: 'Pickup',
	/** The season/week toggle's own name, apart from the section's. */
	figuresFor: 'Figures for',
	/** On a card that reads this week's Proj in place of a rest-of-season order (K, D/ST). */
	weekTag: 'this week',
	/** On a card with no figure to rank yet. */
	waits: "Ranks once this week's Proj is read.",
	allHead: 'Every free agent we rank',
	allSays: 'Pick a position to set them against your players there.',
	yours: (word: string): string => `Your ${word}`,
	freeAt: (word: string): string => `Free at ${word}`,
	swapped: (word: string): string =>
		`${word} has no rest-of-season order, so its card ranks this week's Proj.`,
	/** Where a position's own read failed: its players from the screen's first read stay listed. */
	firstRead: (word: string): string => `Showing the first read's players at ${word}.`
} as const;

/** The standing a card reads in the mode: its own, or on Rest of season where the position has no
 * rest-of-season order (K, D/ST) this week's, marked as such; null where neither is read. */
export function navStanding(
	card: Pick<WaiverPositionCard, 'rest_of_season' | 'week'>,
	mode: PanelMode
): { standing: WaiverStanding; swapped: boolean } | null {
	const own = mode === 'season' ? card.rest_of_season : card.week;
	if (own !== null) return { standing: own, swapped: false };
	if (mode === 'season' && card.week !== null) return { standing: card.week, swapped: true };
	return null;
}

/** One card, as the row draws it. */
export interface NavCard {
	key: NavKey;
	word: string;
	/** "rank 9 of 12"; on the All card the free agents' count; null with no figure (the card says
	 * what it waits on, never a bare "--"). */
	place: string | null;
	/** The member's figure (on All, how many beat a player of his); null with no figure. */
	figure: string | null;
	/** "155.6 median"; on All, "Every position"; null with no figure. */
	foot: string | null;
	/** Words beside the figure: "this week" on a swapped card (its Proj), short enough for a phone's card, the All card's count words. */
	tag: string | null;
	need: boolean;
	/** The strip's pickups include one here. */
	pickup: boolean;
	/** Said in place of a figure where none is read yet. */
	waits: string | null;
	/** The member's figure as a share of twice the median, 0 to 1 (the median at the half), and
	 * whether it is under the median; null where there is no median to draw against. */
	meter: { share: number; under: boolean } | null;
}

/** The counts the All card says. */
export interface NavCounts {
	free: number;
	gaining: number;
}

/** The free agents a set of rows holds and how many beat a player of the member's. */
export function navCounts(rows: readonly { gains: boolean }[]): NavCounts {
	return { free: rows.length, gaining: rows.filter((r) => r.gains).length };
}

/** A count card (All, or a position where the answer carries no panel): the free agents and how many
 * beat a player of the member's. */
function countCard(key: NavKey, word: string, counts: NavCounts, foot: string | null): NavCard {
	return {
		key,
		word,
		place: `${String(counts.free)} ${NAV.freeAgents}`,
		figure: String(counts.gaining),
		foot,
		tag: NAV.beat,
		need: false,
		pickup: false,
		waits: null,
		meter: null
	};
}

function meterOf(standing: WaiverStanding): NavCard['meter'] {
	if (standing.median <= 0) return null;
	const ratio = standing.points / standing.median;
	return { share: Math.max(0, Math.min(1, ratio / 2)), under: ratio < 1 };
}

function positionCard(
	card: WaiverPositionCard,
	mode: PanelMode,
	pickups: ReadonlySet<string>
): NavCard {
	const read = navStanding(card, mode);
	const base = {
		key: card.position,
		word: positionWord(card.position),
		pickup: pickups.has(card.position)
	};
	if (read === null) {
		return {
			...base,
			place: null,
			figure: null,
			foot: null,
			tag: null,
			need: false,
			waits: NAV.waits,
			meter: null
		};
	}
	const { standing, swapped } = read;
	return {
		...base,
		place: placeWords(standing, card.teams),
		figure: boxNumber(standing.points),
		foot: `${boxNumber(standing.median)} ${PANEL.median}`,
		tag: swapped ? NAV.weekTag : null,
		// The need is the rest of the season's (the profile's): never marked on this week's figures.
		need: card.need && mode === 'season' && !swapped,
		waits: null,
		meter: meterOf(standing)
	};
}

/** The row of cards: All first, then each position the answer's panel carries, in its order. An
 * answer without the panel (an older API, or no rest-of-season points read) still navigates: a count
 * card for each position its rows hold, in the board's order. */
export function navCards(
	advice: Pick<WaiverAdvice, 'positions' | 'pickups'>,
	mode: PanelMode,
	counts: NavCounts,
	byPosition: ReadonlyMap<WaiverPosition, NavCounts>
): NavCard[] {
	const pickups = new Set(advice.pickups.map((p) => p.add.player.position));
	const all = countCard(ALL, NAV.all, counts, NAV.every);
	if (advice.positions === undefined || advice.positions.length === 0) {
		return [
			all,
			...[...byPosition].map(([p, c]) => ({
				...countCard(p, positionWord(p), c, null),
				pickup: pickups.has(p)
			}))
		];
	}
	return [all, ...advice.positions.map((c) => positionCard(c, mode, pickups))];
}

/** The card the screen opens on (ruling 2): the Need with the weakest rank, the first in the panel's
 * order on a tie; All where no card marks one. */
export function openingKey(advice: Pick<WaiverAdvice, 'positions'>): NavKey {
	let weakest: WaiverPositionCard | null = null;
	for (const card of advice.positions ?? []) {
		if (!card.need || card.rest_of_season === null) continue;
		if (weakest?.rest_of_season == null || card.rest_of_season.rank > weakest.rest_of_season.rank) {
			weakest = card;
		}
	}
	return weakest?.position ?? ALL;
}

/** One of the member's players at the chosen position, in the table's columns. */
export interface YoursRow {
	key: string;
	row: BoxRow;
	/** His rest-of-season points a game, the table's A game. */
	rest: number | null;
	/** Starter or Bench in the mode's lineup. */
	role: string;
	starts: boolean;
}

/** The member's players at the position, starters first, then by the mode's figure (his
 * rest-of-season points, or this week's Proj), none last; empty for All or a position without a card. */
export function yoursRows(
	advice: Pick<WaiverAdvice, 'positions'>,
	key: NavKey,
	mode: PanelMode,
	zone: string,
	now: number
): YoursRow[] {
	const card = (advice.positions ?? []).find((c) => c.position === key);
	if (card === undefined) return [];
	const starts = (m: WaiverPositionCard['mine'][number]): boolean =>
		mode === 'season' ? m.starter : m.starts_this_week;
	const figure = (m: WaiverPositionCard['mine'][number]): number =>
		(mode === 'season' ? m.rest_of_season_points : m.line.week_projection) ??
		Number.NEGATIVE_INFINITY;
	return [...card.mine]
		.sort((a, b) => Number(starts(b)) - Number(starts(a)) || figure(b) - figure(a))
		.map((m) => ({
			key: `yours:${m.line.player.host_id}`,
			row: { ...boxRow(m.line, '', zone, false, now), key: `yours:${m.line.player.host_id}` },
			rest: m.line.rest_of_season_per_game,
			role: starts(m) ? WAIVERS.starter : WAIVERS.bench,
			starts: starts(m)
		}));
}

/** The line over the comparison: the chosen card's rank, and beside it only what the card cannot
 * say (a Need's meaning, a swapped figure's); All's words for All. The rank's own meaning is said once
 * a mode, by the toggle (PANEL.explain), and the figure and median are the card's. A position with no
 * panel card (an older answer) is named alone. */
export function navLead(
	advice: Pick<WaiverAdvice, 'positions'>,
	key: NavKey,
	mode: PanelMode
): { head: string; words: string | null } {
	if (key === ALL) return { head: NAV.allHead, words: NAV.allSays };
	const word = positionWord(key);
	const card = (advice.positions ?? []).find((c) => c.position === key);
	const read = card === undefined ? null : navStanding(card, mode);
	if (card === undefined || read === null) return { head: word, words: null };
	const { standing, swapped } = read;
	const need = card.need && mode === 'season' && !swapped;
	return {
		head: `${word} ${placeWords(standing, card.teams)}`,
		words: swapped ? NAV.swapped(word) : need ? PANEL.needSays : null
	};
}

/** A narrowed answer kept on screen while the next lands, less any free agent the fresher answer has
 * on the member's roster (claimed since): he is never listed as free and as his at once. */
export function withoutRostered<T extends Pick<WaiverAdvice, 'rows' | 'stash'>>(
	answer: T,
	roster: readonly { player: { host_id: string } }[]
): T {
	const mine = new Set(roster.map((l) => l.player.host_id));
	if (mine.size === 0) return answer;
	const free = (r: WaiverAdvice['rows'][number]): boolean => !mine.has(r.add.player.host_id);
	return { ...answer, rows: answer.rows.filter(free), stash: answer.stash?.filter(free) };
}

/** The list's order the toggle sets: the season Gain (the table's default) or this week's Proj. */
export function navSort(mode: PanelMode): Sort {
	return mode === 'season' ? DEFAULT_SORT : { key: 'proj', down: true };
}

/** The answer's rows at one position: the comparison's free agents until the position's own read
 * lands (and the stash's, as the narrowed answer lists them). */
export function atPosition<T extends Pick<WaiverAdvice, 'rows' | 'stash'>>(
	advice: T,
	key: NavKey
): T {
	if (key === ALL) return advice;
	const here = (r: WaiverAdvice['rows'][number]): boolean => r.add.player.position === key;
	return { ...advice, rows: advice.rows.filter(here), stash: advice.stash?.filter(here) };
}
