/** Sign-out's half of the context: everything an account's leagues left in this browser goes, so
 * whoever comes next reads none of it. Apart from boot.ts so only the account page carries it. */
import { CONTEXT_KEY, LINES_KEY } from './boot.ts';
import { HELD_KEY } from './held.ts';

/** Forgets the session's copy, its rosters and the line hint: at sign-out, before the redirect. */
export function forgetContext(): void {
	try {
		sessionStorage.removeItem(CONTEXT_KEY);
		sessionStorage.removeItem(HELD_KEY);
		localStorage.removeItem(LINES_KEY);
	} catch {
		// Storage off: nothing was kept.
	}
}
