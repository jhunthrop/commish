/** The platforms, in the order every page names them, with what each does here (the sweep's C13): a
 * live draft read from it, a league followed from it always or once its switch is open. The follow
 * page, the signed-out account page and the free page all name them from this one module, so they
 * never read against each other. Apart from model.ts so the account and pass pages carry only this. */
import type { components } from '#lib/api/types.ts';
import { hostWords } from './names.ts';

type LeagueHost = components['schemas']['LeagueHost'];

/** What a platform does here: its live draft is read (the live draft companion, by the draft's
 * link), and its league is followed always or only while its switch is open. */
export interface Platform {
	readonly liveDraft: boolean;
	readonly switched: boolean;
}

export const PLATFORMS: Readonly<Record<LeagueHost, Platform>> = {
	sleeper: { liveDraft: true, switched: false },
	mfl: { liveDraft: false, switched: false },
	ffpc: { liveDraft: false, switched: true },
	yahoo: { liveDraft: false, switched: true },
	espn: { liveDraft: false, switched: true }
};

/** The platforms in naming order, apart from their flags so a page that only lists them (the shell's
 * league switch) carries no flags; the test holds the two to one order. */
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

/** A platform followed only while its switch is open. */
function isSwitched(host: LeagueHost): host is keyof OpenHosts {
	return PLATFORMS[host].switched;
}

function isOpen(host: LeagueHost, open: OpenHosts): boolean {
	return !isSwitched(host) || open[host];
}

/** The platforms a live draft is read from, in the order every page names them. */
export function liveDraftHosts(): LeagueHost[] {
	return LEAGUE_HOSTS.filter((host) => PLATFORMS[host].liveDraft);
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
