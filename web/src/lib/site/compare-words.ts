/** Compare's own words (Lane 66x): the first step before both players are in, so an empty page is
 * never two inputs on a blank canvas, in the call's verb ("take", verdict.ts), and the sentence when
 * the players do not load. */

/** What the page says while a side is empty; null once both are picked, where the call speaks. */
export function firstStep(picked: number): string | null {
	if (picked <= 0)
		return 'Pick two players to see which one we would take, with their figures side by side.';
	if (picked === 1) return 'Pick a second player to set beside the first.';
	return null;
}

/** The head's sentence when the players' index does not load. */
export const COMPARE_FAILED = 'The players are not loading. Try again in a moment.';
