/** The hosts a league is followed from, in the order every page names them, and the two ways a page
 * names them: the follow page's (each where it is open) and the signed-out account page's. One list,
 * so the two pages never disagree. Apart from model.ts so the account page carries only this. */
import type { components } from '#lib/api/types.ts';
import { hostWords } from './names.ts';

type LeagueHost = components['schemas']['LeagueHost'];

export const LEAGUE_HOSTS: readonly LeagueHost[] = ['sleeper', 'mfl', 'ffpc', 'yahoo', 'espn'];

/** What following a league gives in season, in one sentence for a first-timer: the three in-season
 * screens, by what each decides. Said on the follow page and on the signed-out account page. */
export const IN_SEASON_TOOLS_LINE =
	'Each week we show the lineup to start, your best add on waivers and the trades that help both teams.';

/** Which of the hosts that open by switch are open (HOST_FFPC_ENABLED, HOST_YAHOO_ENABLED,
 * HOST_ESPN_ENABLED); Sleeper and MyFantasyLeague always are. */
export interface OpenHosts {
	readonly ffpc: boolean;
	readonly yahoo: boolean;
	readonly espn: boolean;
}

function isOpen(host: LeagueHost, open: OpenHosts): boolean {
	return host === 'sleeper' || host === 'mfl' || open[host];
}

/** The hosts open here, in the order every page names them: the one place the shared list is
 * filtered by the switches, so the follow page and the account page always agree. */
export function openLeagueHosts(open: OpenHosts): LeagueHost[] {
	return LEAGUE_HOSTS.filter((host) => isOpen(host, open));
}

/** The hosts as the follow page says it: "Works with Sleeper leagues, public MyFantasyLeague
 * leagues, FFPC leagues, Yahoo leagues and ESPN leagues.", each switched host only where open. */
export function hostsLine(open: OpenHosts): string {
	const hosts = openLeagueHosts(open).map((host) =>
		host === 'mfl' ? `public ${hostWords(host)} leagues` : `${hostWords(host)} leagues`
	);
	const last = hosts.pop() ?? '';
	return `Works with ${hosts.join(', ')} and ${last}.`;
}

/** The hosts as the signed-out account page says it, each switched host only where open: "Sleeper,
 * MyFantasyLeague, FFPC, Yahoo or ESPN". */
export function leagueHostsLine(open: OpenHosts): string {
	const hosts = openLeagueHosts(open).map(hostWords);
	const last = hosts.pop() ?? '';
	return `${hosts.join(', ')} or ${last}`;
}

/** Every switched host shut: the account page's line until the hosts answer which are open. */
export const SWITCHED_SHUT: OpenHosts = { ffpc: false, yahoo: false, espn: false };
