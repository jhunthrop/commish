/** One rule for a decision strip's cards (Lane 115, B87), on Waivers and Trades alike: the first
 * card, the best, draws its verb solid and says Best in words when there is more than one; every
 * other card draws the same words quiet, so a strip spends one orange. */

export const STRIP = {
	/** The word over the first card of more than one. */
	best: 'Best'
} as const;

/** Whether the card at index is the strip's lead: its first, the best, whose verb is the solid one. */
export function stripLead(index: number): boolean {
	return index === 0;
}

/** The word over a strip card: "Best" on the first of more than one (each screen puts its best
 * first); null on every other card and on a strip of one, which has nothing to be best among. */
export function stripMark(index: number, count: number): string | null {
	return stripLead(index) && count > 1 ? STRIP.best : null;
}
