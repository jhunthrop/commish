/** The pass page's and the claim page's calls to the request API, typed from the generated
 * contract: the catalog, who is signed in, checkout, and a group pass's link. */
import { PUBLIC_API_URL } from '$app/env/public';
import { ApiError, apiClient } from '#lib/api/client.ts';
import type { components } from '#lib/api/types.ts';

type Schemas = components['schemas'];
export type Account = Schemas['Account'];
export type Feature = Schemas['Feature'];
export type CheckoutRequest = Schemas['CheckoutRequest'];
export type GroupPass = Schemas['GroupPass'];
export type GroupPassPreview = Schemas['GroupPassPreview'];
export type Interval = Schemas['Interval'];
export type PlanCatalog = Schemas['PlanCatalog'];

const client = apiClient(PUBLIC_API_URL);

export { ApiError };

export const HTTP = { unauthorized: 401, notFound: 404, conflict: 409, gone: 410 } as const;

/** Whether an error is the API saying nobody is signed in. */
export function isSignedOut(error: unknown): boolean {
	return error instanceof ApiError && error.status === HTTP.unauthorized;
}

/** The signed-in account, or null signed out. Any other failure throws. */
export async function currentAccount(): Promise<Account | null> {
	try {
		return await client.call<Account>('/me');
	} catch (error) {
		if (isSignedOut(error)) return null;
		throw error;
	}
}

export const pass = {
	plans: () => client.call<PlanCatalog>('/billing/plans'),
	/** Where the browser goes to pay: Stripe's checkout, or the local fake in development. */
	checkout: async (body: CheckoutRequest) =>
		(await client.call<{ url: string }>('/billing/checkout', { method: 'POST', body })).url,
	groupPasses: () => client.call<GroupPass[]>('/billing/group-passes'),
	preview: (code: string) =>
		client.call<GroupPassPreview>(`/group-passes/${encodeURIComponent(code)}`),
	claim: (code: string) =>
		client.call<Account>(`/group-passes/${encodeURIComponent(code)}/claim`, { method: 'POST' }),
	signInUrl: (returnTo: string) => client.signInUrl(returnTo)
};
