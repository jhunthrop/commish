/** A checkout a signed-out drafter asked for, carried through sign-in in the pass page's address so
 * the page picks it up on the way back and goes straight on to checkout. */
import { links } from '#lib/site/links.ts';
import type { CheckoutRequest, Interval } from './pass-api.ts';

/** The query keys, and Lane 3's canceled return (`/pass?checkout=canceled`). */
const KEY = { product: 'get', interval: 'interval', seats: 'seats', league: 'league' } as const;
export const CHECKOUT_KEY = 'checkout';
export const CHECKOUT_CANCELED = 'canceled';

/** The league name's bound, the API's (1 to 60 characters). */
export const LEAGUE_NAME_MAX = 60;

const INTERVALS: readonly Interval[] = ['year', 'month'];

/** The pass page's address that resumes this checkout after sign-in. */
export function resumePath(request: CheckoutRequest): string {
	const params = new URLSearchParams({ [KEY.product]: request.product });
	if (request.interval) params.set(KEY.interval, request.interval);
	if (request.seats != null) params.set(KEY.seats, String(request.seats));
	if (request.league_name) params.set(KEY.league, request.league_name);
	return `${links.pass()}?${params.toString()}`;
}

/** The checkout an address asks to resume, or null for none or one that does not read. The API
 * validates it again; this only refuses what could never be a request. */
export function intentFrom(params: Pick<URLSearchParams, 'get'>): CheckoutRequest | null {
	switch (params.get(KEY.product)) {
		case 'draft_pass':
			return { product: 'draft_pass' };
		case 'membership': {
			const interval = params.get(KEY.interval);
			return {
				product: 'membership',
				interval: INTERVALS.find((i) => i === interval) ?? 'year'
			};
		}
		case 'group_pass': {
			const seats = Number(params.get(KEY.seats));
			const league = (params.get(KEY.league) ?? '').trim().slice(0, LEAGUE_NAME_MAX);
			if (!Number.isInteger(seats) || league === '') return null;
			return { product: 'group_pass', seats, league_name: league };
		}
		default:
			return null;
	}
}

/** Where this browser notes the checkout it sent a reader to sign in for. Only an address that
 * matches the note goes straight on to checkout; any other `/pass?get=...` link, crafted or old,
 * fills in the choices and waits for the verb. */
const RESUME_NOTE = 'commish:pass-resume';

/** Notes the checkout before sign-in. */
export function noteResume(request: CheckoutRequest): void {
	sessionStorage.setItem(RESUME_NOTE, resumePath(request));
}

/** Whether the address's checkout is the one this browser noted, taking the note either way. */
export function takeResume(request: CheckoutRequest): boolean {
	const noted = sessionStorage.getItem(RESUME_NOTE);
	sessionStorage.removeItem(RESUME_NOTE);
	return noted === resumePath(request);
}
