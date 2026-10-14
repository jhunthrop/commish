/** Disney's own sign-in for ESPN, in a window of its own: the account page opens /espn-connect
 * (static/espn-connect.html and .js, under the CSP in web/_headers), the member signs in on
 * Disney's form there (two-factor is Disney's to ask), and that window hands back what Disney
 * answered to this page alone. This page picks out the two ESPN values and passes them to the API,
 * which keeps them encrypted. No Disney script ever runs on a page of the site. */

/** The window Disney's sign-in runs in, and how it is opened. */
const CONNECT_PAGE = '/espn-connect';
const WINDOW_NAME = 'commish-espn';
const WINDOW_FEATURES = 'popup,width=480,height=720';
/** What the window's messages say they are. */
const MESSAGE_KIND = 'commish-espn';
/** How often the page looks whether the window was closed. */
const CLOSED_POLL_MS = 400;

/** The two ESPN values a session carries, as the API takes them. */
export interface ESPNSession {
	readonly swid: string;
	readonly s2: string;
}

/** How Disney's sign-in ended: the session it handed back, a sign-in that handed back no session,
 * the window closed before a sign-in (the verb is ready again at once), or a window that could not
 * open or load Disney's sign-in. */
export type DisneyOutcome =
	| { readonly kind: 'session'; readonly session: ESPNSession }
	| { readonly kind: 'no-session' }
	| { readonly kind: 'closed' }
	| { readonly kind: 'failed' };

const SWID = /^\{?[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}?$/;
const MAX_DEPTH = 6;

/** The braced SWID the cookie carries, from a SWID with or without its braces. */
function braced(swid: string): string {
	return `{${swid.replace(/^\{|\}$/g, '')}}`;
}

/** The SWID and s2 anywhere in what the widget hands back (its login event, its guest), by their
 * names: `swid` and `s2`. Null when either is missing. */
export function findSession(data: unknown): ESPNSession | null {
	const found: { swid: string | null; s2: string | null } = { swid: null, s2: null };
	const walk = (value: unknown, depth: number): void => {
		if (depth > MAX_DEPTH || value === null || typeof value !== 'object') return;
		for (const [key, inner] of Object.entries(value)) {
			if (typeof inner === 'string') {
				const name = key.toLowerCase();
				if (name === 'swid' && SWID.test(inner)) found.swid ??= braced(inner);
				if (name === 's2' && inner.length >= 40) found.s2 ??= inner;
			} else {
				walk(inner, depth + 1);
			}
		}
	};
	walk(data, 0);
	const { swid, s2 } = found;
	return swid !== null && s2 !== null ? { swid, s2 } : null;
}

/** The outcome a message from the sign-in window carries, null for a message that is not one. */
export function outcomeOf(message: unknown): DisneyOutcome | null {
	if (message === null || typeof message !== 'object') return null;
	const { kind, outcome, payload } = message as Record<string, unknown>;
	if (kind !== MESSAGE_KIND) return null;
	switch (outcome) {
		case 'signed-in': {
			const session = findSession(payload);
			return session ? { kind: 'session', session } : { kind: 'no-session' };
		}
		case 'closed':
			return { kind: 'closed' };
		case 'failed':
			return { kind: 'failed' };
	}
	return null;
}

/** Open Disney's sign-in in its own window and wait for how it ends. A message is taken only from
 * that window, on our own origin. Closing the window ends the wait at once. */
export function signInWithDisney(): Promise<DisneyOutcome> {
	const opened = window.open(CONNECT_PAGE, WINDOW_NAME, WINDOW_FEATURES);
	if (!opened) return Promise.resolve({ kind: 'failed' });
	return new Promise((resolve) => {
		let settled = false;
		const finish = (outcome: DisneyOutcome): void => {
			if (settled) return;
			settled = true;
			window.removeEventListener('message', onMessage);
			clearInterval(watch);
			resolve(outcome);
		};
		const onMessage = (event: MessageEvent): void => {
			if (event.origin !== window.location.origin || event.source !== opened) return;
			const outcome = outcomeOf(event.data);
			if (outcome) finish(outcome);
		};
		const watch = setInterval(() => {
			// A message the window sent as it closed is already queued: it is
			// read before the closing is.
			if (opened.closed) setTimeout(() => finish({ kind: 'closed' }), 0);
		}, CLOSED_POLL_MS);
		window.addEventListener('message', onMessage);
	});
}
