/** The print sheet's words (Lane 66x): its way back, its verb, what an empty sheet says in place
 * of a blank page, one sentence under its head, and a page's column heads. Carried into shared/words
 * and the apps' Words by shared/scripts/gen-words.ts (Lane 283). */
export const PRINT_WORDS = {
	back: 'Back to your sheet',
	print: 'Print',
	emptyTitle: 'Nothing to print yet',
	emptyLine: 'Put players on your sheet first, and they print here, a page for each position.',
	player: 'Player',
	overall: 'Overall'
} as const;
