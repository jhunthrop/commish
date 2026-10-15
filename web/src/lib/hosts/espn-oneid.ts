/** Disney's own sign-in for ESPN, in a window of its own on the workers.dev origin, where no Commish
 * cookie lives (ESPN_SIGN_IN_ORIGIN, src/lib/site/origins.ts): the member signs in on Disney's form
 * there (two-factor is Disney's to ask), and that window hands what Disney answered to this page by
 * postMessage, at the site's origin alone (espn-window.ts). This page takes a message only from that
 * window on that origin, picks out the two ESPN values and passes them to the API with the session.
 * Along the way the window posts the names of the widget events it saw, never their data, so a
 * sign-in that hands nothing over says what Disney did. No Disney script ever runs on an origin
 * that carries our cookies. */
import { ESPN_SIGN_IN_ORIGIN } from '#lib/site/origins.ts';
import { findSession, type ESPNSession } from './espn-session.ts';
import { MESSAGE_KIND, WIDGET_EVENTS, type WidgetEvent } from './espn-window.ts';

/** The window Disney's sign-in runs in, and how it is opened. */
const CONNECT_PAGE = `${ESPN_SIGN_IN_ORIGIN}/espn-connect`;
const WINDOW_NAME = 'commish-espn';
const WINDOW_FEATURES = 'popup,width=480,height=720';
/** How often the page looks whether the window was closed. */
const CLOSED_POLL_MS = 400;
/** The longest widget reason the page repeats, and how many event names it keeps. */
const MAX_REASON = 120;
const MAX_SEEN = 12;
const NO_REASON = 'no reason given';

/** How Disney's sign-in ended: the session it handed back, a sign-in that handed back no session,
 * the member closing the window with its own button (the verb is ready again at once), the window
 * gone with no word at all, the widget refusing in its own words, or a window that could not open
 * or load Disney's sign-in. */
export type DisneyOutcome =
	| { readonly kind: 'session'; readonly session: ESPNSession }
	| { readonly kind: 'no-session' }
	| { readonly kind: 'closed' }
	| { readonly kind: 'nothing' }
	| { readonly kind: 'error'; readonly reason: string }
	| { readonly kind: 'failed' };

/** What one message from the window says: the widget events seen so far, and the outcome when the
 * message is the window's last (null while the window is still working). */
export interface WindowNews {
	readonly seen: readonly WidgetEvent[];
	readonly outcome: DisneyOutcome | null;
}

/** How the sign-in ended, with the widget events the window saw. */
export interface SignInEnd {
	readonly outcome: DisneyOutcome;
	readonly seen: readonly WidgetEvent[];
}

const KNOWN_EVENTS: ReadonlySet<string> = new Set(WIDGET_EVENTS);

function seenOf(value: unknown): readonly WidgetEvent[] {
	if (!Array.isArray(value)) return [];
	return value
		.filter((name): name is WidgetEvent => typeof name === 'string' && KNOWN_EVENTS.has(name))
		.slice(0, MAX_SEEN);
}

/** The widget's reason as plain text: printable characters only, cut short. */
function reasonOf(value: unknown): string {
	if (typeof value !== 'string') return NO_REASON;
	const printable = value.replace(/[^\x20-\x7E]/g, '').trim();
	return printable === '' ? NO_REASON : printable.slice(0, MAX_REASON);
}

function finalOutcome(fields: Record<string, unknown>): DisneyOutcome | null | undefined {
	switch (fields.outcome) {
		case 'signed-in': {
			const session = findSession(fields.payload);
			return session ? { kind: 'session', session } : { kind: 'no-session' };
		}
		case 'closed':
			return { kind: 'closed' };
		case 'error':
			return { kind: 'error', reason: reasonOf(fields.reason) };
		case 'failed':
			return { kind: 'failed' };
		case 'seen':
			return null;
	}
	return undefined;
}

/** What a message from the sign-in window says, null for a message that is not one. */
export function readMessage(message: unknown): WindowNews | null {
	if (message === null || typeof message !== 'object') return null;
	const fields = message as Record<string, unknown>;
	if (fields.kind !== MESSAGE_KIND) return null;
	const outcome = finalOutcome(fields);
	return outcome === undefined ? null : { seen: seenOf(fields.seen), outcome };
}

/** What a message event says when it comes from the sign-in window on the sign-in origin, null for
 * any other: a message from another origin, or another window, is never read. */
export function fromSignInWindow(
	event: { readonly origin: string; readonly source: unknown; readonly data: unknown },
	opened: unknown
): WindowNews | null {
	if (event.origin !== ESPN_SIGN_IN_ORIGIN || opened === null || event.source !== opened) {
		return null;
	}
	return readMessage(event.data);
}

/** Open Disney's sign-in in its own window and wait for how it ends. The window is opened at once,
 * inside the tap, so no browser takes it for an unasked popup. The wait ends only on the window's
 * last message or the window being gone, never while it is still working. */
export function signInWithDisney(): Promise<SignInEnd> {
	const opened = window.open(CONNECT_PAGE, WINDOW_NAME, WINDOW_FEATURES);
	if (!opened) return Promise.resolve({ outcome: { kind: 'failed' }, seen: [] });
	return new Promise((resolve) => {
		let settled = false;
		let seen: readonly WidgetEvent[] = [];
		const finish = (outcome: DisneyOutcome): void => {
			if (settled) return;
			settled = true;
			window.removeEventListener('message', onMessage);
			clearInterval(watch);
			resolve({ outcome, seen });
		};
		const onMessage = (event: MessageEvent): void => {
			const news = fromSignInWindow(event, opened);
			if (!news) return;
			seen = news.seen;
			if (news.outcome) finish(news.outcome);
		};
		const watch = setInterval(() => {
			// A message the window sent as it closed is already queued: it is
			// read before the closing is.
			if (opened.closed) setTimeout(() => finish({ kind: 'nothing' }), 0);
		}, CLOSED_POLL_MS);
		window.addEventListener('message', onMessage);
	});
}
