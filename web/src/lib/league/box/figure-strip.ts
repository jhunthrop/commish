/** A box row's figures as a strip of labelled cells (Lane 209): where a table's figure columns give
 * way, below a wide screen, each figure keeps its own head over it instead of folding into a sentence
 * ("Over repl. 52.8, A game 10.3, ..." was a paragraph, never a box score). The Rankings order and the
 * kickers' and defenses' week draw it with FigureStrip. */
import { BOX, boxNumber, easeOf, oppRankWord, type Ease, type RowEvidence } from './box.ts';

/** One cell: its head and its figure as printed. */
export interface StripCell {
	head: string;
	value: string;
	/** The figure the rows sort on, in ink: a sorted column draws its key on every row. */
	key?: boolean;
	/** The opponent's rank, tinted by how easy he is (OppRank); null without a rank. */
	ease?: Ease | null;
	/** A short figure under a short head (the week's "13.0" under "Wk 6"): a narrower share of the
	 * strip, so the longer heads keep their room at 320 px. */
	narrow?: boolean;
}

/** A figure's cell, "--" when not held. */
export function figureCell(
	head: string,
	value: number | null,
	extra: Pick<StripCell, 'key' | 'narrow'> = {}
): StripCell {
	return { head, value: boxNumber(value), ...extra };
}

/** The opponent's rank against his position, tinted, "--" without one (a bye). */
export function oppCell(evidence: Pick<RowEvidence, 'oppRank' | 'oppOf'>): StripCell {
	const rank = evidence.oppRank;
	return {
		head: BOX.oppRank,
		value: oppRankWord(rank),
		ease: rank === null ? null : easeOf(rank, evidence.oppOf)
	};
}

/** Avg and Last, the evidence every box score ends on. */
export function formCells(
	evidence: Pick<RowEvidence, 'avg' | 'last'>
): readonly [avg: StripCell, last: StripCell] {
	return [figureCell(BOX.avg, evidence.avg), figureCell(BOX.last, evidence.last)];
}

/** A narrow cell's share of the strip beside each other cell's one. */
const NARROW_SHARE = 0.6;

/** The strip's grid tracks, one fixed share per cell, so the heads line up row to row at every
 * width (review M6). */
export function stripTracks(cells: readonly StripCell[]): string {
	return cells.map((c) => `minmax(0, ${String(c.narrow === true ? NARROW_SHARE : 1)}fr)`).join(' ');
}
