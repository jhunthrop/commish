/** The Gap's tone and its words in picks (Lane 66q), apart from format/gap.ts so the chip on the
 * player page and the sheet does not load the board rows' chunk (vite.config.ts's rows group holds
 * gap.ts). The run's figure printed as given: the web never works a gap out. */
import { fixed } from './number.ts';

/** Plus is green (drafters wait, a value for you), minus is rose (they reach), zero is neither. */
export type GapTone = 'gain' | 'loss' | 'even';

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
