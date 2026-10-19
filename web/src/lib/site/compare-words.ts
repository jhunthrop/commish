/** Compare's first step (Lane 66x): what the page says before both players are in, so an empty page
 * is never two inputs on a blank canvas. Null once both are picked, where the call speaks. */
export function firstStep(picked: number): string | null {
	if (picked <= 0)
		return 'Pick two players to see which one we draft, with their figures side by side.';
	if (picked === 1) return 'Pick a second player to set beside the first.';
	return null;
}
