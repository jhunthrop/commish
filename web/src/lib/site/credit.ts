/** The licence minimum (founder ruling 2026-10-15): the nflverse feeds are CC BY 4.0 and FTN's
 * charting via nflverse is CC BY-SA 4.0, and both licences ask for the licence, the source and the
 * note that the figures were changed, where the data appears. The player page prints this one line
 * (Credit.svelte, written as markup and held to these words by credit.test.ts)
 * at its foot, where the charted figures are, and the Terms of Service print it where they name our
 * figures (Lane 151). No other page prints a credit. */

/** The stricter of the two licences. */
export const CREDIT_LICENCE_HREF = 'https://creativecommons.org/licenses/by-sa/4.0/';

/** The sentence in three parts: the words before the linked licence name, the name, the rest. */
export const CREDIT = {
	before: 'Stats from nflverse and charting from FTN Data via nflverse, both under ',
	licenceWords: 'Creative Commons licences',
	after: ', our rates worked out from their counts.'
} as const;

/** The sentence as a reader hears it. */
export function creditSentence(): string {
	return `${CREDIT.before}${CREDIT.licenceWords}${CREDIT.after}`;
}
