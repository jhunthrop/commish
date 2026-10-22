/** The free page's words (Lane 150, the founder's 2026-10-22 ruling: the 2026 season is free): what
 * every account has this season, and what stays free whatever the season. The platforms are
 * league/hosts.ts's. Pure, so the page and the account page say it the same way. */
import { listWords } from '#lib/format/list.ts';
import { leagueHostsLine, type OpenHosts } from '#lib/league/hosts.ts';
import type { Section } from '#lib/ui/nav.ts';

/** One line of the list: what it is, in a drafter's terms, and the section whose page it opens. */
export interface FreeLine {
	lead: string;
	text: string;
	section: Section;
}

/** The page's head, lead, note, verbs and footer, in the free season and outside it. */
export const FREE_WORDS = {
	season: {
		title: 'Free this season',
		lead: 'Every tool on Commish is free through the 2026 season, for every account.',
		listHead: 'On every account this season',
		description:
			"Every tool on Commish is free through the 2026 season: every league you play in, your league's exact scoring, the board, every player, mock drafts and your cheat sheet."
	},
	always: {
		title: 'Free on Commish',
		lead: 'The board, every player, our record, mock drafts and your cheat sheet are free for every account.',
		listHead: 'Free for every account',
		description:
			'The board, every player, ADP and our record, mock drafts and your cheat sheet, free for every account.'
	},
	note: 'Nothing to pay and no card to give.',
	signIn: 'Sign in',
	follow: 'Follow your league',
	later: 'Paid tiers come later. Nothing on your account changes this season.'
} as const;

/** What stays free whatever the season: the board and the prep tools. */
const PREP_LINES: readonly FreeLine[] = [
	{
		lead: 'The board',
		text: 'in every format, with tiers and the drop to the next one',
		section: 'board'
	},
	{
		lead: 'Every player',
		text: 'his projection, its basis, and the writing on him',
		section: 'players'
	},
	{
		lead: 'ADP and our record',
		text: 'where drafters take him, and how our board and our weekly order have done',
		section: 'record'
	},
	{
		lead: 'Mock drafts',
		text: 'against bots or people, with our call at every pick and the report',
		section: 'mock'
	},
	{
		lead: 'Your cheat sheet',
		text: 'ranks, tiers, tags and notes, on every device you sign in on',
		section: 'sheet'
	}
];

/** Outside the free season: the prep tools and one league. */
export const ALWAYS_FREE: readonly FreeLine[] = [
	...PREP_LINES,
	{
		lead: 'One league',
		text: "yours, kept up to date: your roster, this week's matchup, the players nobody holds and every move",
		section: 'league'
	}
];

/** In the free season: every league on the platforms open here, its exact scoring, the season's
 * screens, the week's rankings and the live draft companion, then the prep tools. */
export function freeSeasonLines(open: OpenHosts): readonly FreeLine[] {
	return [
		{
			lead: 'Every league you play in',
			text: `on ${leagueHostsLine(open)}, kept up to date`,
			section: 'league'
		},
		{
			lead: "Your league's exact scoring",
			text: "the board and your mock drafts by your league's own rules",
			section: 'mock'
		},
		{
			lead: 'Your lineup, waivers and trades',
			text: 'each week, from your own roster',
			section: 'lineup'
		},
		{
			lead: "The week's rankings",
			text: 'every player in our order for the week, with his game',
			section: 'players'
		},
		{
			lead: 'Our call in your real draft',
			text: 'paste your draft link and get our pick at every one of your turns',
			section: 'advisor'
		},
		...PREP_LINES
	];
}

/** What stays free in one sentence, from the prep lines the page prints: "The board, every player,
 * ADP and our record, mock drafts and your cheat sheet stay free." */
export function freeLine(): string {
	const [first = '', ...rest] = PREP_LINES.map((line) => line.lead);
	// An acronym keeps its capitals ("ADP"), a word drops its own ("Every player" to "every player").
	const lower = (lead: string): string =>
		/^[A-Z][a-z]/.test(lead) ? lead.charAt(0).toLowerCase() + lead.slice(1) : lead;
	const names = [first, ...rest.map(lower)];
	return `${listWords(names)} stay free.`;
}
