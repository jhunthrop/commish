/** Where the numbers come from: every recurring feed the research package reads, in the site's
 * words, with the credit each publisher asks for (`docs/research/data-sources.md`). The `/data` page
 * prints them, and every page that prints a charted figure links there. */

/** The `/data` page's own title: short, so the display face never breaks it a line longer than the
 * fallback face does when it arrives. */
export const DATA_PAGE_TITLE = 'Our data';

/** The credits' section, and the words of every link to it. */
export const SOURCES_TITLE = 'Where the numbers come from';

/** The registry: every recurring feed in `docs/research/data-sources.md`, by the name its table gives
 * it. Each is credited by exactly one sentence below (tested against the doc's table). */
export const RECURRING_FEEDS = [
	'Player universe',
	'Weekly player stats',
	'Snap counts',
	'Schedule and results',
	'Play-by-play, current season',
	'FTN charting',
	'Next Gen Stats',
	'PFR advanced stats',
	'Player props',
	'Tank01 captures',
	'ADP',
	'Host player ids',
	'Season win totals'
] as const;
export type RecurringFeed = (typeof RECURRING_FEEDS)[number];

/** One credit's sentence: the words before its credit, the credit linked to the publisher's page,
 * and the rest of the sentence, the licence named where one exists. `feeds` are the registry's feeds
 * it credits. */
export interface Source {
	feeds: readonly RecurringFeed[];
	before: string;
	credit: string;
	href: string;
	after: string;
}

export const SOURCES_LEAD =
	'Every figure on Commish starts in one of these feeds, credited the way its publisher asks.';

export const SOURCES: readonly Source[] = [
	{
		feeds: [
			'Player universe',
			'Weekly player stats',
			'Snap counts',
			'Schedule and results',
			'Play-by-play, current season'
		],
		before:
			'Play-by-play, weekly stat lines, snap counts, depth charts, the player list and the schedule from ',
		credit: 'nflverse',
		href: 'https://github.com/nflverse/nflverse-data',
		after: ', shared under the CC BY 4.0 licence.'
	},
	{
		feeds: ['FTN charting'],
		before: 'Charting from ',
		credit: 'FTN Data via nflverse',
		href: 'https://ftndata.com',
		after:
			', the contested catches, blitzes and interception-worthy throws, shared under the CC BY-SA 4.0 licence.'
	},
	{
		feeds: ['Next Gen Stats'],
		before: 'Next Gen Stats from ',
		credit: 'the NFL via nflverse',
		href: 'https://nextgenstats.nfl.com',
		after: ', the separation, time to throw and yards over expected.'
	},
	{
		feeds: ['PFR advanced stats'],
		before: 'Advanced stats from ',
		credit: 'Pro Football Reference via nflverse',
		href: 'https://www.pro-football-reference.com',
		after: ', the drops, pressures and yards after contact.'
	},
	{
		feeds: ['ADP'],
		before: 'ADP from ',
		credit: 'Fantasy Football Calculator',
		href: 'https://fantasyfootballcalculator.com/adp',
		after: ', its PPR, half PPR, standard and two-quarterback drafts.'
	},
	{
		feeds: ['Tank01 captures'],
		before: 'Injury reports, inactives, depth charts and news through the week from ',
		credit: 'the Tank01 NFL API on RapidAPI',
		href: 'https://rapidapi.com/tank01/api/tank01-nfl-live-in-game-real-time-statistics-nfl',
		after: '.'
	},
	{
		feeds: ['Player props'],
		before: 'The consensus expectations for each player that the board reads, from ',
		credit: 'The Odds API',
		href: 'https://the-odds-api.com',
		after: '.'
	},
	{
		feeds: ['Season win totals'],
		before: "Each team's season win expectation that the board reads, from ",
		credit: 'nfelo',
		href: 'https://github.com/greerreNFL/nfelosrs',
		after: '.'
	},
	{
		feeds: ['Host player ids'],
		before: "The ids that match each host's players to ours, from ",
		credit: 'DynastyProcess',
		href: 'https://github.com/dynastyprocess/data',
		after: '.'
	}
];

/** A source's whole sentence, as a reader hears it. */
export function sourceSentence({ before, credit, after }: Source): string {
	return `${before}${credit}${after}`;
}
