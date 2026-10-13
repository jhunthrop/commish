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

/** The consent the FFPC form asks for, word for word what the API keeps as consent version 2
 * (api/internal/hosts ConsentVersion): change the words, raise the version. */
export const FFPC_CONSENT =
	'We sign in to FFPC as you to read your league. We never make a move or a bid. Your league-mates on Commish see your league as we read it. You can disconnect any time.';

/** Whether FFPC is open here (HOST_FFPC_ENABLED), from the hosts answer. */
export function ffpcOpen(hosts: HostConnections): boolean {
	return hosts.enabled.includes('ffpc');
}

/** Whether an answer says the FFPC connection needs a fresh sign-in. */
export function needsSignIn(error: unknown): boolean {
	return error instanceof ApiError && (error.status === 409 || error.status === 404);
}
