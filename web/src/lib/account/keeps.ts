/** What an account keeps and the hosts a signed-out visitor can connect, in the words the page prints. */
import { LEAGUE_HOSTS_LINE } from '#lib/league/hosts.ts';

/** The five hosts a league can be followed from, in the site's words and the order /league/new names
 * them: built from the one list both pages read. */
export { LEAGUE_HOSTS_LINE };

/** What an account keeps, said to a reader who has none yet. */
/** `link` names the account link a line goes to, so this file stays free of the router. */
export const KEEPS: readonly { lead: string; text: string; link?: 'leagueNew' | 'pass' }[] = [
	{
		lead: 'Your cheat sheets',
		text: 'on every device you sign in on, with your notes and tiers'
	},
	{ lead: 'Your mock drafts', text: 'and the report on each one' },
	{
		lead: 'Your leagues',
		text: `on ${LEAGUE_HOSTS_LINE}, kept up to date`,
		link: 'leagueNew'
	},
	{
		lead: 'Your Draft Pass or Membership',
		text: 'and the receipts for it',
		link: 'pass'
	}
];

/** The hosts read as the member: each a row whose verb signs in, then returns to the account page. */
export const MEMBER_HOSTS = [
	{
		lead: 'Yahoo',
		text: 'Sign in, then connect Yahoo to follow your Yahoo leagues.',
		verb: 'Connect Yahoo'
	},
	{
		lead: 'ESPN',
		text: 'Sign in, then connect ESPN to follow your ESPN leagues, public or private. We keep an encrypted copy of your ESPN session so your league stays in sync and, when you ask, to make your moves.',
		verb: 'Connect ESPN'
	}
] as const;
