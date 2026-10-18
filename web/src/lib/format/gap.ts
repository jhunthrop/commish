/** The board's Gap as every page prints it (Lane 66n): drafters' ADP less our rank, written by the
 * run to a tenth and printed as given, its text and its tone said here once, so the board row and
 * Compare never drift apart on the minus glyph, the zero or the colour. A run older than the column
 * carries none, so a screen shows the Gap only where one of its rows carries it (carriesGap). */
import { EMPTY_FIGURE } from './empty.ts';
import { fixed, signed } from './number.ts';

/** Plus is green (drafters wait, a value for you), minus is rose (they reach), zero is neither. */
export type GapTone = 'gain' | 'loss' | 'even';

/** "+1.8", "−4.5", "0.0"; "--" for a player the run gives no gap. */
export function gapText(gap: number | null | undefined): string {
	if (gap === null || gap === undefined) return EMPTY_FIGURE;
	return gap === 0 ? fixed(0) : signed(gap);
}

/** The tone the signed-gap ruling gives the figure, null for none. */
export function gapTone(gap: number | null | undefined): GapTone | null {
	if (gap === null || gap === undefined) return null;
	return gap > 0 ? 'gain' : gap < 0 ? 'loss' : 'even';
}

/** A gap in picks, as a chip or a sentence says it: "3.5 picks later", "1.0 pick earlier". The run's
 * tenth as given; a zero gap is said by its caller ("Same spot"). */
export function gapPicks(gap: number): string {
	const picks = Math.abs(gap);
	return `${fixed(picks)} ${picks === 1 ? 'pick' : 'picks'} ${gap > 0 ? 'later' : 'earlier'}`;
}

/** What a gap chip says for a player (the sheet's ADP chip, the player page, the system page): his
 * gap in picks, "Same spot", or "No ADP" when the drafts do not take him; null where the run wrote
 * no Gap (a run older than the column), which draws no chip rather than a gap the web works out. */
export function gapChipWords(row: { adp: number | null; gap?: number | null }): string | null {
	if (row.adp === null) return 'No ADP';
	if (row.gap === undefined || row.gap === null) return null;
	return row.gap === 0 ? 'Same spot' : gapPicks(row.gap);
}

/** Whether a screen's rows carry the run's Gap: any one of them does (review 66n re-review N1). A
 * run older than the column carries it on none, and its screens draw no Gap column, no Gap sentence
 * and no Gap sort, rather than an empty column under a sentence about its colours. */
export function carriesGap(rows: readonly { gap?: number | null }[]): boolean {
	return rows.some((row) => row.gap !== undefined && row.gap !== null);
}
