/** Connected host accounts (FFPC, read as the member) and paired devices, typed from the contract.
 * The password goes to the API once, on connect, and is never read back: no route answers it. */
import { PUBLIC_API_URL } from '$app/env/public';
import { ApiError, apiClient } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';

type Schemas = components['schemas'];
export type HostConnection = Schemas['HostConnection'];
export type HostConnections = Schemas['HostConnections'];
export type HostConnected = Schemas['HostConnected'];
export type HostLeague = Schemas['HostLeague'];
export type Device = Schemas['Device'];
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
	devices: () => client.call<Device[]>('/devices'),
	pairCode: () => client.call<PairCode>('/devices/codes', { method: 'POST' }),
	revokeDevice: (id: string) =>
		client.call<null>(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' })
};

/** The consent the FFPC form asks for, word for word what the API keeps as consent version 3
 * (api/internal/hosts ConsentVersion): change the words, raise the version. */
export const FFPC_CONSENT =
	'We sign in to FFPC as you to read your league, and never make a move or a bid. We keep your FFPC password, encrypted, to sign in again when FFPC signs you out, at most once every six hours. League-mates on Commish see the league we read, never your lineup. Disconnect on your account page deletes your password and session at once.';

/** FFPC's own rule on sharing a password, under the consent, so the member decides. */
export const FFPC_TERMS =
	"FFPC's terms ask members not to share their password, and connecting shares it with Commish.";

/** Whether FFPC is open here (HOST_FFPC_ENABLED), from the hosts answer. */
export function ffpcOpen(hosts: HostConnections): boolean {
	return hosts.enabled.includes('ffpc');
}

/** Whether an answer says the FFPC connection needs a fresh sign-in (409). */
export function needsSignIn(error: unknown): boolean {
	return error instanceof ApiError && error.status === 409;
}

/** Whether an answer says the account has no FFPC connection yet (404 on its league list). */
export function notConnected(error: unknown): boolean {
	return error instanceof ApiError && error.status === 404;
}
