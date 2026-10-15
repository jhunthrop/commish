/** Where the numbers come from: every recurring feed the research package reads, in the site's
 * words, with the credit each publisher asks for (`docs/research/data-sources.md`). The `/data` page
 * prints them, and every page that prints a charted figure links there. */

/** The page's title, and the words of every link to it. */
export const SOURCES_TITLE = 'Where the numbers come from';

/** One feed's sentence: the words before its credit, the credit linked to the publisher's page,
 * and the rest of the sentence, the licence named where one exists. */
export interface Source {
	before: string;
	credit: string;
	href: string;
	after: string;
}

export const SOURCES_LEAD =
	'Every figure on Commish starts in one of these feeds, credited the way its publisher asks.';

export const SOURCES: readonly Source[] = [
	{
		before: 'Play-by-play, weekly stat lines, snap counts and depth charts from ',
		credit: 'nflverse',
		href: 'https://github.com/nflverse/nflverse-data',
		after: ', shared under the CC BY 4.0 licence.'
	},
	{
		before: 'Charting from ',
		credit: 'FTN Data via nflverse',
		href: 'https://ftndata.com',
		after:
			', the contested catches, blitzes and interception-worthy throws in our reads, shared under the CC BY-SA 4.0 licence.'
	},
	{
		before: 'Next Gen Stats from ',
		credit: 'the NFL via nflverse',
		href: 'https://nextgenstats.nfl.com',
		after: ', the separation, time to throw and yards over expected in our reads.'
	},
	{
		before: 'Advanced stats from ',
		credit: 'Pro Football Reference via nflverse',
		href: 'https://www.pro-football-reference.com',
		after: ', the drops, pressures and yards after contact in our reads.'
	},
	{
		before: 'Average draft position from ',
		credit: 'Fantasy Football Calculator',
		href: 'https://fantasyfootballcalculator.com/adp',
		after: ', its PPR, half PPR, standard and two-quarterback drafts.'
	},
	{
		before: 'Injury reports, inactives, depth charts and news through the week from ',
		credit: 'the Tank01 NFL API on RapidAPI',
		href: 'https://rapidapi.com/tank01/api/tank01-nfl-live-in-game-real-time-statistics-nfl',
		after: '.'
	}
];

/** A source's whole sentence, as a reader hears it. */
export function sourceSentence({ before, credit, after }: Source): string {
	return `${before}${credit}${after}`;
}
