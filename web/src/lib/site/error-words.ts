/** The site's error pages' words (Lane 148): the prerendered not-found page the Worker serves with a
 * 404 (routes/404), and the Worker's own error page for every other failure (routes/+error.svelte).
 * The in-season screens say the not-found in the same words (league/inseason/words.ts LINES, held
 * equal by routes/not-found-words.test.ts). */
export const ERROR_WORDS = {
	notFound: {
		bar: 'Page not found',
		head: 'Not found',
		lead: 'Nothing lives at this address.'
	},
	broke: {
		bar: 'Something broke',
		head: 'Error',
		lead: 'This page did not load. Try it again in a moment.'
	},
	/** The one way on (the sweep's C14): the board, where every other page is a tap away. */
	toBoard: 'Go to the board'
} as const;

export type ErrorWords = (typeof ERROR_WORDS)['notFound' | 'broke'];
