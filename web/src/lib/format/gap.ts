/** The board's Gap as every page prints it (Lane 66n): drafters' ADP less our rank, written by the
 * run to a tenth and printed as given, its text and its tone said here once, so the board row and
 * Compare never drift apart on the minus glyph, the zero or the colour. A run older than the column
 * carries none, so a screen shows the Gap only where one of its rows carries it (carriesGap). */
import { EMPTY_FIGURE } from './empty.ts';
import { gapTone, type GapTone } from './gap-picks.ts';
import { fixed, signed } from './number.ts';

export { gapTone, type GapTone };

/** "+1.8", "−4.5", "0.0"; "--" for a player the run gives no gap. */
export function gapText(gap: number | null | undefined): string {
	if (gap === null || gap === undefined) return EMPTY_FIGURE;
	return gap === 0 ? fixed(0) : signed(gap);
}

/** Whether a screen's rows carry the run's Gap: any one of them does (review 66n re-review N1). A
 * run older than the column carries it on none, and its screens draw no Gap column, no Gap sentence
 * and no Gap sort, rather than an empty column under a sentence about its colours. */
export function carriesGap(rows: readonly { gap?: number | null }[]): boolean {
	return rows.some((row) => row.gap !== undefined && row.gap !== null);
}
