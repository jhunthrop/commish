/** Back from checkout (`/account?checkout=done&bought=draft_pass`): the payment is made, and the
 * webhook that turns it on may land a moment after the browser does. The page reads the account
 * until what was bought is there, and says so in words. Pure, so the page only polls and draws. */
import type { components } from '#lib/api/types.ts';
import type { AccountState } from './account-api.ts';
import { hasLiveMembership } from './words.ts';

type Product = components['schemas']['Product'];

export const ARRIVAL_POLL_MS = 2000;
/** Thirty seconds of asking before the page says it is taking longer than it should. */
export const ARRIVAL_TRIES = 15;
/** A group pass made this recently is the one just paid for. */
const RECENT_MS = 15 * 60_000;

const PRODUCTS: readonly Product[] = ['draft_pass', 'membership', 'group_pass'];

export type Arrival = { kind: 'none' } | { kind: 'waiting' | 'on' | 'slow'; bought: Product };

/** The product a return address says was bought, or null when it is not a checkout return. */
export function boughtFrom(params: Pick<URLSearchParams, 'get'>): Product | null {
	if (params.get('checkout') !== 'done') return null;
	const bought = params.get('bought');
	return PRODUCTS.find((p) => p === bought) ?? 'draft_pass';
}

/** Whether the account now shows what was bought. */
export function hasArrived(view: AccountState, bought: Product, now: number): boolean {
	if (view.kind !== 'signed-in') return false;
	switch (bought) {
		case 'draft_pass':
			return view.account.draft_pass !== null || hasLiveMembership(view.account);
		case 'membership':
			return hasLiveMembership(view.account);
		case 'group_pass':
			return view.groupPasses.some((g) => now - Date.parse(g.created_at) < RECENT_MS);
	}
}

const ON: Readonly<Record<Product, string>> = {
	draft_pass: 'Thanks. Your Draft Pass is on.',
	membership: 'Thanks. Your Membership is on.',
	group_pass: 'Thanks. Your group pass is below. Copy the claim link and send it to your league.'
};

/** What the page says while it waits, once it has arrived, and if it is slow. */
export function arrivalWords(arrival: Arrival): string | null {
	switch (arrival.kind) {
		case 'none':
			return null;
		case 'waiting':
			return 'Payment received. It turns on here in a few seconds.';
		case 'on':
			return ON[arrival.bought];
		case 'slow':
			return 'Payment received, and it is taking longer than usual to turn on. Reload in a minute. If it is still not here, write to hello@trycommish.app.';
	}
}
