/** What an account keeps and the hosts a signed-out visitor can connect, in the words the page prints,
 * each switched host named only where it is open (the hosts answer's `enabled`). */
import { IN_SEASON_TOOLS_LINE, leagueHostsLine, type OpenHosts } from '#lib/league/hosts.ts';
import { FLAGS } from '#lib/site/flags.ts';

/** What following a league says on this page: the hosts open here and, while the in-season screens
 * are on, the tools, both read from the module /league/new reads. */
export function leaguesKeptText(open: OpenHosts): string {
	return `on ${leagueHostsLine(open)}, kept up to date.${FLAGS.in_season_tools ? ` ${IN_SEASON_TOOLS_LINE}` : ''}`;
}

/** One line of what an account keeps. `link` names the account link a line goes to, so this file
 * stays free of the router. */
export interface KeepLine {
	lead: string;
	text: string;
	link?: 'leagueNew' | 'pass';
}

/** The signed-out page's heading: in season the leagues are why to sign in, before the draft the prep. */
export function signedOutTitle(inSeason: boolean): string {
	return inSeason ? 'Sign in to keep your leagues and your prep' : 'Sign in to keep your prep';
}

/** What an account keeps, said to a reader who has none yet: in season your leagues first. */
export function keeps(open: OpenHosts, inSeason: boolean): readonly KeepLine[] {
	const leagues: KeepLine = {
		lead: 'Your leagues',
		text: leaguesKeptText(open),
		link: 'leagueNew'
	};
	const prep: readonly KeepLine[] = [
		{
			lead: 'Your cheat sheets',
			text: 'on every device you sign in on, with your notes and tiers'
		},
		{ lead: 'Your mock drafts', text: 'and the report on each one' }
	];
	const pass: KeepLine = {
		lead: 'Your Draft Pass or Membership',
		text: 'and the receipts for it',
		link: 'pass'
	};
	return inSeason ? [leagues, ...prep, pass] : [...prep, leagues, pass];
}

/** A host read as the member: a row whose verb signs in, then returns to the account page. */
export interface MemberHost {
	lead: string;
	text: string;
	verb: string;
}

const MEMBER_HOSTS: readonly (MemberHost & { host: 'yahoo' | 'espn' })[] = [
	{
		host: 'yahoo',
		lead: 'Yahoo',
		text: 'Sign in, then connect Yahoo to follow your Yahoo leagues.',
		verb: 'Connect Yahoo'
	},
	{
		host: 'espn',
		lead: 'ESPN',
		text: 'Sign in, then connect ESPN to follow your ESPN leagues, public or private. We keep an encrypted copy of your ESPN session so your league stays in sync and we can make your moves when you ask.',
		verb: 'Connect ESPN'
	}
];

/** The hosts read as the member that are open here. */
export function memberHosts(open: OpenHosts): readonly MemberHost[] {
	return MEMBER_HOSTS.filter((h) => open[h.host]).map(({ lead, text, verb }) => ({
		lead,
		text,
		verb
	}));
}
