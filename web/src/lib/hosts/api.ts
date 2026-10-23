/** Connected host accounts (FFPC, Yahoo and ESPN, read as the member) and paired devices, typed from the
 * contract.
 * The password goes to the API once, on connect, and is never read back: no route answers it. */
import { PUBLIC_API_URL } from '$app/env/public';
import { ApiError, apiClient } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';
import type { OpenHosts } from '#lib/league/hosts.ts';
import { ESPN_CONSENT_VERSION, MFL_CONSENT_VERSION } from './connection-words.ts';

type Schemas = components['schemas'];
export type HostConnection = Schemas['HostConnection'];
export type HostConnections = Schemas['HostConnections'];
export type HostConnected = Schemas['HostConnected'];
export type HostLeague = Schemas['HostLeague'];
export type Device = Schemas['Device'];
export type ConnectedHost = Schemas['ConnectedHost'];
type Redirect = Schemas['Redirect'];

/** What a pick of several FFPC leagues came to, said under the verb: a summary and each miss. */
export interface PickAnswer {
	status: string;
	problems: readonly string[];
}
export type PairCode = Schemas['PairCode'];

const client = apiClient(PUBLIC_API_URL);

export { ApiError };

export const hostsApi = {
	connections: () => client.call<HostConnections>('/hosts'),
	connectFFPC: (email: string, password: string, consent: boolean) =>
		client.call<HostConnected>('/hosts/ffpc/connect', {
			method: 'POST',
			body: { email, password, consent }
		}),
	ffpcLeagues: () => client.call<HostLeague[]>('/hosts/ffpc/leagues'),
	disconnectFFPC: () => client.call<null>('/hosts/ffpc', { method: 'DELETE' }),
	/** Yahoo's authorize address, with a state bound to this account for ten minutes. */
	connectYahoo: (returnTo?: string) =>
		client.call<Redirect>('/hosts/yahoo/connect', {
			method: 'POST',
			body: returnTo === undefined ? {} : { return_to: returnTo }
		}),
	yahooLeagues: () => client.call<HostLeague[]>('/hosts/yahoo/leagues'),
	disconnectYahoo: () => client.call<null>('/hosts/yahoo', { method: 'DELETE' }),
	/** The member's two ESPN cookies, kept encrypted once one read of their leagues shows they work:
	 * proven when a private league reads with them too, else kept with a note saying why. */
	connectESPN: (swid: string, s2: string) =>
		client.call<HostConnected>('/hosts/espn/connect', {
			method: 'POST',
			body: { swid, espn_s2: s2, consent: true, consent_version: ESPN_CONSENT_VERSION }
		}),
	espnLeagues: () => client.call<HostLeague[]>('/hosts/espn/leagues'),
	disconnectESPN: () => client.call<null>('/hosts/espn', { method: 'DELETE' }),
	/** The member's MyFantasyLeague username and password, sent once: the API exchanges them at
	 * MyFantasyLeague's login and keeps only the session it answers. */
	connectMFL: (username: string, password: string) =>
		client.call<HostConnected>('/hosts/mfl/connect', {
			method: 'POST',
			body: { username, password, consent: true, consent_version: MFL_CONSENT_VERSION }
		}),
	mflLeagues: () => client.call<HostLeague[]>('/hosts/mfl/leagues'),
	disconnectMFL: () => client.call<null>('/hosts/mfl', { method: 'DELETE' }),
	devices: () => client.call<Device[]>('/devices'),
	pairCode: () => client.call<PairCode>('/devices/codes', { method: 'POST' }),
	revokeDevice: (id: string) =>
		client.call<null>(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
};

/** FFPC's own rule on sharing a password, under the consent, so the member decides. */
export const FFPC_TERMS =
	"FFPC's terms ask members not to share their password, and connecting shares it with Commish.";

/** Whether FFPC is open here (HOST_FFPC_ENABLED), from the hosts answer. */
export function ffpcOpen(hosts: HostConnections): boolean {
	return hosts.enabled.includes('ffpc');
}

/** Whether Yahoo is open here (HOST_YAHOO_ENABLED with the app's keys), from the hosts answer. */
export function yahooOpen(hosts: HostConnections): boolean {
	return hosts.enabled.includes('yahoo');
}

/** Whether connecting ESPN is open here (HOST_ESPN_ENABLED with the key), from the hosts answer. */
export function espnOpen(hosts: HostConnections): boolean {
	return hosts.enabled.includes('espn');
}

/** Which switched platforms are open here, from the hosts answer: the pages that name the platforms
 * a league is followed from read it (league/hosts.ts). */
export function openHostsOf(hosts: HostConnections): OpenHosts {
	return { ffpc: ffpcOpen(hosts), yahoo: yahooOpen(hosts), espn: espnOpen(hosts) };
}

/** Whether connecting MyFantasyLeague is open to this account (HOST_WRITES_MFL_LINEUP with the key,
 * or the account on its proof list), from the hosts answer. */
export function mflOpen(hosts: HostConnections): boolean {
	return hosts.enabled.includes('mfl');
}

/** Disconnect one host: what we keep for it is deleted at once. */
export function disconnect(host: ConnectedHost): Promise<null> {
	switch (host) {
		case 'ffpc':
			return hostsApi.disconnectFFPC();
		case 'yahoo':
			return hostsApi.disconnectYahoo();
		case 'espn':
			return hostsApi.disconnectESPN();
		case 'mfl':
			return hostsApi.disconnectMFL();
	}
}

export { ESPN_CONSENT, FFPC_CONSENT, MFL_CONSENT } from './connection-words.ts';

/** The account's connection to one host, if any. */
export function connectionTo(
	hosts: HostConnections,
	host: ConnectedHost
): HostConnection | undefined {
	return hosts.connections.find((c) => c.host === host);
}

/** Open Yahoo's own sign-in in this tab: Yahoo sends the member back to the page they started from
 * (returnTo, a path on the site) or to the account page, which says how it went (yahooOutcome). */
export async function goToYahoo(returnTo?: string): Promise<void> {
	const { url } = await hostsApi.connectYahoo(returnTo);
	const target = new URL(url);
	// Only Yahoo's own sign-in is ever opened from here.
	if (target.protocol !== 'https:' || target.host !== YAHOO_SIGN_IN_HOST) {
		throw new Error('Yahoo sign-in answered an address that is not Yahoo');
	}
	window.location.assign(target.toString());
}

/** The host Yahoo's sign-in lives on. */
const YAHOO_SIGN_IN_HOST = 'api.login.yahoo.com';

/** Whether an answer says the FFPC connection needs a fresh sign-in (409). */
export function needsSignIn(error: unknown): boolean {
	return error instanceof ApiError && error.status === 409;
}

/** Whether an answer says the account has no FFPC connection yet (404 on its league list). */
export function notConnected(error: unknown): boolean {
	return error instanceof ApiError && error.status === 404;
}
