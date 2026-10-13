/** The live-draft companion's calls to the request API, typed from the generated contract. */
import { PUBLIC_API_URL } from '$app/env/public';
import { ApiError, apiClient } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';

type Schemas = components['schemas'];
export type Companion = Schemas['Companion'];
export type CompanionCreate = Schemas['CompanionCreate'];
export type CompanionPick = Schemas['CompanionPick'];
export type OutcomeRange = Schemas['OutcomeRange'];
export type Account = Schemas['Account'];
export type Feature = Schemas['Feature'];
export type MockReport = Schemas['MockReport'];

const client = apiClient(PUBLIC_API_URL);

export { ApiError };

export const companions = {
	me: () => client.call<Account>('/me'),
	create: (body: CompanionCreate) =>
		client.call<Companion>('/companions', { method: 'POST', body }),
	read: (id: string, since: number) =>
		client.call<Companion>(`/companions/${encodeURIComponent(id)}?since=${String(since)}`),
	report: (id: string) => client.call<MockReport>(`/companions/${encodeURIComponent(id)}/report`),
	signInUrl: (returnTo: string) => client.signInUrl(returnTo)
};
