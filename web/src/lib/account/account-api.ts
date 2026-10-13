/**
 * The account page's calls to the request API (Lane 3's routes, typed from the generated contract):
 * who you are, your sheets and mocks, the membership's cancel and resume, the billing portal and
 * sign out. A signed-out browser is an answer here, not an error.
 */
import { ApiError, type ApiClient } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';

export type Account = components['schemas']['Account'];
export type AccountSheet = components['schemas']['Sheet'];
export type AccountMock = components['schemas']['Mock'];

const UNAUTHORIZED = 401;
/** How many of each list the page shows: the most recent first. */
export const LIST_SIZE = 20;

/** What the page knows about the reader once the first call settles. */
export type AccountState =
	| { kind: 'signed-out' }
	| { kind: 'signed-in'; account: Account; sheets: AccountSheet[]; mocks: AccountMock[] }
	/** The browser has no connection. */
	| { kind: 'offline' }
	/** The browser is online and the API did not answer or answered with a fault. */
	| { kind: 'unreachable' };

export interface AccountApi {
	load(): Promise<AccountState>;
	cancelMembership(): Promise<Account>;
	resumeMembership(): Promise<Account>;
	/** Where the browser goes to change the card or see receipts. */
	billingPortal(): Promise<string>;
	/** Ends the session here and returns where the browser goes to end it at the sign-in provider. */
	signOut(): Promise<string>;
	signInUrl(returnTo: string): string;
}

function isUnauthorized(error: unknown): boolean {
	return error instanceof ApiError && error.status === UNAUTHORIZED;
}

function unreachableKind(online: () => boolean): AccountState {
	return online() ? { kind: 'unreachable' } : { kind: 'offline' };
}

export function accountApi(client: ApiClient, online: () => boolean): AccountApi {
	return {
		async load() {
			let account: Account;
			try {
				account = await client.call<Account>('/me');
			} catch (error) {
				if (isUnauthorized(error)) return { kind: 'signed-out' };
				if (error instanceof ApiError || error instanceof TypeError) return unreachableKind(online);
				throw error;
			}
			const [sheets, mocks] = await Promise.all([
				client.call<AccountSheet[]>(`/sheets?per_page=${String(LIST_SIZE)}`),
				client.call<AccountMock[]>(`/mocks?per_page=${String(LIST_SIZE)}`)
			]);
			return { kind: 'signed-in', account, sheets, mocks };
		},
		cancelMembership: () => client.call<Account>('/billing/membership/cancel', { method: 'POST' }),
		resumeMembership: () => client.call<Account>('/billing/membership/resume', { method: 'POST' }),
		async billingPortal() {
			return (await client.call<{ url: string }>('/billing/portal', { method: 'POST' })).url;
		},
		async signOut() {
			return (await client.call<{ url: string }>('/auth/logout', { method: 'POST' })).url;
		},
		signInUrl: (returnTo) => client.signInUrl(returnTo)
	};
}
