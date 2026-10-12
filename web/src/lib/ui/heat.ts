/** Magnitude. Points over replacement is tinted by the round it ranks in on the board,
 * rounds 1 to 4, then no tint. Below replacement takes the rose wash. The label always
 * prints the round or the minus, so color is never the only channel. */

export const TINTED_ROUNDS = 4;
export const HEATS = ['heat-1', 'heat-2', 'heat-3', 'heat-4', 'heat-neg', 'none'] as const;
export type Heat = (typeof HEATS)[number];

const VOR_LABEL = 'over repl';

export function heatFor(vor: number, round: number): Heat {
	if (vor < 0) return 'heat-neg';
	if (round >= 1 && round <= TINTED_ROUNDS) return `heat-${round}` as Heat;
	return 'none';
}

/** "over repl · rd 1" while tinted, "over repl" otherwise. */
export function vorLabel(vor: number, round: number): string {
	const heat = heatFor(vor, round);
	return heat === 'heat-neg' || heat === 'none' ? VOR_LABEL : `${VOR_LABEL} · rd ${round}`;
}

export interface VorCellProps {
	value: number;
	label: string;
	heat: Heat;
	signed: true;
}

/** Everything a ValueCell needs to print points over replacement: <ValueCell {...vorCell(vor, round)} />. */
export function vorCell(vor: number, round: number): VorCellProps {
	return { value: vor, label: vorLabel(vor, round), heat: heatFor(vor, round), signed: true };
}
