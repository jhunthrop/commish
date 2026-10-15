/** What an account keeps and the hosts a signed-out visitor can connect, in the words the page prints,
 * each switched host named only where it is open (the hosts answer's `enabled`). */
import { leagueHostsLine, type OpenHosts } from '#lib/league/hosts.ts';

/** One line of what an account keeps. `link` names the account link a line goes to, so this file
 * stays free of the router. */
export interface KeepLine {
	lead: string;
	text: string;
	link?: 'leagueNew' | 'pass';
}

/** What an account keeps, said to a reader who has none yet. */
export function keeps(open: OpenHosts): readonly KeepLine[] {
	return [
		{
			lead: 'Your cheat sheets',
			text: 'on every device you sign in on, with your notes and tiers'
		},
		{ lead: 'Your mock drafts', text: 'and the report on each one' },
		{
			lead: 'Your leagues',
			text: `on ${leagueHostsLine(open)}, kept up to date`,
			link: 'leagueNew'
		},
		{
			lead: 'Your Draft Pass or Membership',
			text: 'and the receipts for it',
			link: 'pass'
		}
	];
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
		text: 'Sign in, then connect ESPN to follow your ESPN leagues, public or private. We keep an encrypted copy of your ESPN session so your league stays in sync and, when you ask, to make your moves.',
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
