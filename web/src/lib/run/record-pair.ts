/** A figure of ours beside a yardstick's, drawn at the same size, with the pair's leader named in one
 * word (Lane 140, C05): "level", "ours by 0.2", "ADP by 3". Ours is accented only where it leads, so a
 * tie or a loss never reads as a win. Pure, so the words and the leader are tested here. */
import { RATE_PLACES, figureWords, printPlaces, type RecordFigure } from './record.ts';
import type { Score } from './schema.ts';

/** The places each figure prints to: order matched to two, places off to one, the counts whole. */
const PLACES: Readonly<Record<RecordFigure, number>> = {
	agreement: RATE_PLACES,
	placesOff: 1,
	starters: 0
};

/** Whether a higher figure is the better one: places off alone is better lower. */
const HIGHER_WINS: Readonly<Record<RecordFigure, boolean>> = {
	agreement: true,
	placesOff: false,
	starters: true
};

/** The pair's words, in one place for the copy guard. */
export const PAIR_WORDS = {
	ours: 'Ours',
	level: 'level',
	by: (who: string, margin: string) => `${who} by ${margin}`,
	oursBy: 'ours'
} as const;

export type PairLeader = 'ours' | 'theirs' | 'level';

/** One figure for both orders as a tile or a card draws it. */
export interface FigurePair {
	ours: string;
	theirs: string;
	/** The yardstick's name over its figure: "ADP", "ESPN". */
	name: string;
	/** Who leads, null where either figure is not held. */
	leader: PairLeader | null;
	/** "level", "ours by 0.2", "ADP by 3"; null where either figure is not held. */
	lead: string | null;
}

/** A figure as a whole count of its last printed place, so a margin is the run's figures' own and
 * never a float's remainder: 13.3 at one place is 133. */
function units(score: Score, figure: RecordFigure): number | null {
	const value =
		figure === 'agreement'
			? score.agreement
			: figure === 'placesOff'
				? score.placesOff
				: score.startersOf === 0
					? null
					: score.starters;
	if (value === null) return null;
	// The printed figure's digits, never a rounding of our own (review LOW-1): 13.3 at one place is 133.
	return PLACES[figure] === 0 ? value : Number(printPlaces(value, PLACES[figure]).replace('.', ''));
}

/** The pair for one figure: both printed as their cells print them, the leader by the figure's own
 * direction (places off lower), the margin at the figure's places. */
export function figurePair(
	ours: Score | null,
	theirs: Score | null,
	figure: RecordFigure,
	name: string
): FigurePair {
	const printed = { ours: figureWords(ours, figure), theirs: figureWords(theirs, figure), name };
	const a = ours === null ? null : units(ours, figure);
	const b = theirs === null ? null : units(theirs, figure);
	if (a === null || b === null) return { ...printed, leader: null, lead: null };
	if (a === b) return { ...printed, leader: 'level', lead: PAIR_WORDS.level };
	const oursAhead = HIGHER_WINS[figure] ? a > b : a < b;
	const margin = (Math.abs(a - b) / 10 ** PLACES[figure]).toFixed(PLACES[figure]);
	return {
		...printed,
		leader: oursAhead ? 'ours' : 'theirs',
		lead: PAIR_WORDS.by(oursAhead ? PAIR_WORDS.oursBy : name, margin)
	};
}

/** Whether ours is drawn accented: only where it leads (C05). */
export function oursAccented(pair: Pick<FigurePair, 'leader'>): boolean {
	return pair.leader === 'ours';
}
