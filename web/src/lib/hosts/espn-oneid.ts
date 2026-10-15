/** Disney's own sign-in for ESPN, in a window of its own on the workers.dev origin, where no Commish
 * cookie lives (ESPN_SIGN_IN_ORIGIN, src/lib/site/origins.ts): the member signs in on Disney's form
 * there (two-factor is Disney's to ask), and that window hands what Disney answered to this page by
 * postMessage, at the site's origin alone (espn-window.ts). This page takes a message only from that
 * window on that origin, picks out the two ESPN values and passes them to the API with the session.
 * No Disney script ever runs on an origin that carries our cookies. */
import { ESPN_SIGN_IN_ORIGIN } from '#lib/site/origins.ts';
import { findSession, type ESPNSession } from './espn-session.ts';
import { MESSAGE_KIND } from './espn-window.ts';

/** The window Disney's sign-in runs in, and how it is opened. */
const CONNECT_PAGE = `${ESPN_SIGN_IN_ORIGIN}/espn-connect`;
const WINDOW_NAME = 'commish-espn';
const WINDOW_FEATURES = 'popup,width=480,height=720';
/** How often the page looks whether the window was closed. */
const CLOSED_POLL_MS = 400;

/** How Disney's sign-in ended: the session it handed back, a sign-in that handed back no session,
 * the window closed before a sign-in (the verb is ready again at once), or a window that could not
 * open or load Disney's sign-in. */
export type DisneyOutcome =
	| { readonly kind: 'session'; readonly session: ESPNSession }
	| { readonly kind: 'no-session' }
	| { readonly kind: 'closed' }
	| { readonly kind: 'failed' };

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

/** The outcome a message event carries when it comes from the sign-in window on the sign-in
 * origin, null for any other: a message from another origin, or another window, is never read. */
export function fromSignInWindow(
	event: { readonly origin: string; readonly source: unknown; readonly data: unknown },
	opened: unknown
): DisneyOutcome | null {
	if (event.origin !== ESPN_SIGN_IN_ORIGIN || opened === null || event.source !== opened) {
		return null;
	}
	return outcomeOf(event.data);
}

/** Open Disney's sign-in in its own window and wait for how it ends. The window is opened at once,
 * inside the tap, so no browser takes it for an unasked popup. Closing it ends the wait at once. */
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
			const outcome = fromSignInWindow(event, opened);
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
