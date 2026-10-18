/** The board's Gap as every page prints it (Lane 66n): drafters' ADP less our rank, written by the
 * run to a tenth and printed as given, its text and its tone said here once, so the board row and
 * Compare never drift apart on the minus glyph, the zero or the colour. */
import { fixed, signed } from './number.ts';

/** Plus is green (drafters wait, a value for you), minus is rose (they reach), zero is neither. */
export type GapTone = 'gain' | 'loss' | 'even';

/** "+1.8", "−4.5", "0.0"; empty for a player with no ADP. */
export function gapText(gap: number | null | undefined): string {
	if (gap === null || gap === undefined) return '';
	return gap === 0 ? fixed(0) : signed(gap);
}

/** The tone the signed-gap ruling gives the figure, null for none. */
export function gapTone(gap: number | null | undefined): GapTone | null {
	if (gap === null || gap === undefined) return null;
	return gap > 0 ? 'gain' : gap < 0 ? 'loss' : 'even';
}
