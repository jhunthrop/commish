/** The hosts a league is followed from, in the order every page names them, and the two ways a page
 * names them: the follow page's (each where it is open) and the signed-out account page's. One list,
 * so the two pages never disagree. Apart from model.ts so the account page carries only this. */
import type { components } from '#lib/api/types.ts';
import { hostWords } from './names.ts';

type LeagueHost = components['schemas']['LeagueHost'];

export const LEAGUE_HOSTS: readonly LeagueHost[] = ['sleeper', 'mfl', 'ffpc', 'yahoo', 'espn'];

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

/** The hosts as the follow page says it: "Works with Sleeper leagues, public MyFantasyLeague
 * leagues, FFPC leagues, Yahoo leagues and ESPN leagues.", each switched host only where open. */
export function hostsLine(open: OpenHosts): string {
	const hosts = LEAGUE_HOSTS.filter((host) => isOpen(host, open)).map((host) =>
		host === 'mfl' ? `public ${hostWords(host)} leagues` : `${hostWords(host)} leagues`
	);
	const last = hosts.pop() ?? '';
	return `Works with ${hosts.join(', ')} and ${last}.`;
}

/** The hosts as the signed-out account page says it: "Sleeper, MyFantasyLeague, FFPC, Yahoo or
 * ESPN". */
export const LEAGUE_HOSTS_LINE = `${LEAGUE_HOSTS.slice(0, -1).map(hostWords).join(', ')} or ${hostWords(LEAGUE_HOSTS.at(-1) ?? 'espn')}`;
