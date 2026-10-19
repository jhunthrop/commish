/** The ESPN sign-in window's own script, served from the workers.dev origin (src/routes/espn-connect.js),
 * where no Commish cookie lives. It loads Disney's sign-in for ESPN and hands what Disney answers to
 * its opener with postMessage targeted at the site's origin alone; it never calls our API and never
 * reads a cookie. The script is popupMain's own source, called with its setup written out as source,
 * so it must use nothing outside itself. */
import { ESPN_SIGN_IN_ORIGIN, SITE_ORIGIN } from '#lib/site/origins.ts';
import { findSession } from './espn-session.ts';

/** What the window's messages say they are, shared with the opener (espn-oneid.ts). */
export const MESSAGE_KIND = 'commish-espn';

/** The widget events the window posts by name, never with their data, so the account page can say
 * what Disney did: its init with a guest signed in or not, a login, a logout, an error. */
export const WIDGET_EVENTS = [
	'init-signed-in',
	'init-signed-out',
	'login',
	'logout',
	'error'
] as const;
export type WidgetEvent = (typeof WIDGET_EVENTS)[number];

/** The window's line when Disney had the member signed in but kept the ESPN session to itself: the
 * window signs them out and opens the form, so the handoff happens on the sign-in. */
export const ALREADY_SIGNED_IN_LINE =
	'Disney had you signed in without handing over your ESPN session, so sign in once more on the form above.';

/** Disney's OneID widget (cdn.registerdisney.go.com/v4/OneID.js), the parts the window uses.
 * init() resolves `{ loggedIn, guest }`. launchLogin() opens the form, and refuses with "Session
 * already established" when a guest is signed in. getGuest(true, { forceRefresh: true }) reads the
 * guest afresh from Disney's guest service with `s2` expanded. logout() ends the session. on() hears
 * init, login, logout and error. */
export interface PopupWidget {
	init: () => Promise<unknown>;
	launchLogin: () => Promise<unknown>;
	logout: () => Promise<unknown>;
	getGuest: (fullPayload?: boolean, options?: { forceRefresh?: boolean }) => Promise<unknown>;
	on: (event: string, handler: (data: unknown) => void) => void;
}

/** The parts of a window the script uses, so a test can run it. */
export interface PopupWindow {
	opener: { closed: boolean; postMessage: (message: unknown, targetOrigin: string) => void } | null;
	location: { origin: string; hostname: string };
	close: () => void;
	setTimeout: (handler: () => void, ms: number) => unknown;
	localStorage: { removeItem: (key: string) => void };
	document: {
		cookie: string;
		getElementById: (id: string) => {
			textContent: string | null;
			addEventListener: (event: string, handler: () => void) => void;
		} | null;
		createElement: (tag: 'script') => {
			src: string;
			onload: (() => void) | null;
			onerror: (() => void) | null;
		};
		head: { appendChild: (node: unknown) => unknown };
	};
	OneID?: {
		get: (options: { clientId: string; responderPage: string }) => PopupWidget;
	};
}

/** What the window runs with: the site's origin it hands Disney's answer to, the sign-in origin it
 * must be on, findSession (espn-session.ts) to tell whether a guest Disney already had signed in
 * carries the two ESPN values, and the line it says when one does not. */
export interface PopupSetup {
	readonly siteOrigin: string;
	readonly signInOrigin: string;
	readonly find: (data: unknown) => unknown;
	readonly alreadySignedInLine: string;
}

/** The window's script. Served on any origin but the sign-in origin (the same build also serves the
 * site), it loads nothing: Disney's script never runs where our cookies are.
 *
 * On the sign-in origin it first forgets the session Disney's widget stored there on an earlier
 * sign-in. Disney's guest service refuses this origin (its CORS preflight answers 403), so a stored
 * session the widget wants to refresh or re-read sends a request that can never answer, and the
 * widget's init then never settles: the window sat at its first line (Lane 88). Forgotten, the
 * widget starts signed out and opens Disney's form, and the sign-in hands over through the login,
 * which runs inside Disney's own frame. A guest Disney still reports signed in is read through the
 * widget; one whose session the widget keeps is signed out and shown the form once. A form that is
 * not up within STALL_MS ends the window as a sign-in that did not open, so the account page offers
 * the pasted values instead of a window that waits forever. */
export function popupMain(win: PopupWindow, setup: PopupSetup): void {
	const ONEID_SCRIPT = 'https://cdn.registerdisney.go.com/v4/OneID.js';
	const ESPN_CLIENT_ID = 'ESPN-ONESITE.WEB-PROD';
	const RESPONDER = '/espn-responder';
	const KIND = 'commish-espn';
	const MAX_REASON = 120;
	const FORM_UP = 'Sign in on the form above. Closing this window goes back.';
	/** How long Disney's form has to come up before the window gives up on it. */
	const STALL_MS = 30_000;
	/** Disney's session as its widget keeps it on this origin: the cookies its own sign-out expires
	 * (responder.js, guest.logout), set on the host's dotted domain, and the guest it caches. */
	const STORED_COOKIES = ['ab2', 'idn', 'rt', 'token', 'ts']
		.map((name) => `${ESPN_CLIENT_ID}.${name}`)
		.concat(`${ESPN_CLIENT_ID}-ac`);
	const STORED_GUEST = `${ESPN_CLIENT_ID}.guest`;
	const EXPIRED = '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
	const seen: string[] = [];
	let done = false;
	let formUp = false;

	const post = (message: Record<string, unknown>): void => {
		const opener = win.opener;
		if (opener && !opener.closed) {
			opener.postMessage({ kind: KIND, ...message, seen: [...seen] }, setup.siteOrigin);
		}
	};

	/** Hands the outcome to the opener, at the site's origin only, and closes. Once. */
	const send = (outcome: Record<string, unknown>): void => {
		if (done) return;
		done = true;
		post(outcome);
		win.close();
	};

	/** Hands over the two ESPN values found in what the widget answered, and nothing else of the
	 * guest: no name, email or linked account leaves this origin. Null when either is missing. */
	const handOver = (answered: unknown): void => {
		send({ outcome: 'signed-in', payload: setup.find(answered) });
	};

	/** Notes a widget event by name and tells the opener at once, so a window closed by hand still
	 * leaves word of what Disney did. */
	const saw = (event: string): void => {
		seen.push(event);
		if (!done) post({ outcome: 'seen' });
	};

	/** The widget's own reason for a refusal: its error codes only, never free text. */
	const reasonOf = (error: unknown): string => {
		const codes = (error as { errorCodes?: unknown } | null)?.errorCodes;
		const reason = Array.isArray(codes) ? codes.join(',') : codes;
		return typeof reason === 'string' && reason !== '' ? reason.slice(0, MAX_REASON) : 'unknown';
	};

	const line = win.document.getElementById('line');
	const say = (words: string): void => {
		if (line) line.textContent = words;
	};

	win.document.getElementById('close')?.addEventListener('click', () => {
		send({ outcome: 'closed' });
	});
	if (win.location.origin !== setup.signInOrigin) {
		say('This page opens from your Commish account page.');
		return;
	}

	/** Expires Disney's stored session by name, never reading a cookie. */
	const forgetStoredSession = (): void => {
		for (const name of STORED_COOKIES) {
			win.document.cookie = `${name}${EXPIRED}`;
			win.document.cookie = `${name}${EXPIRED}; domain=.${win.location.hostname}`;
		}
		try {
			win.localStorage.removeItem(STORED_GUEST);
		} catch {
			// Storage the browser refuses holds no guest to forget.
		}
	};

	const begin = (widget: PopupWidget): void => {
		const readGuest = (): Promise<unknown> =>
			widget.getGuest(true, { forceRefresh: true }).catch(() => null);
		const launch = (words: string): Promise<void> =>
			widget.launchLogin().then(() => {
				formUp = true;
				say(words);
			});
		/** A guest already signed in: handed over when the widget yields both values, else signed
		 * out and shown the form. */
		const handOverExisting = (): Promise<void> =>
			readGuest().then((guest) => {
				if (setup.find({ guest }) !== null) {
					handOver({ guest });
					return;
				}
				say(setup.alreadySignedInLine);
				return widget.logout().then(() => launch(setup.alreadySignedInLine));
			});

		widget.on('login', (login) => {
			saw('login');
			void readGuest().then((guest) => {
				handOver({ login, guest });
			});
		});
		widget.on('logout', () => {
			saw('logout');
		});
		widget.on('error', () => {
			saw('error');
		});

		widget
			.init()
			.then((state) => {
				const signedIn = (state as { loggedIn?: unknown } | null)?.loggedIn === true;
				saw(signedIn ? 'init-signed-in' : 'init-signed-out');
				return signedIn ? handOverExisting() : launch(FORM_UP);
			})
			.catch((error: unknown) => {
				send({ outcome: 'error', reason: reasonOf(error) });
			});
	};

	forgetStoredSession();
	const script = win.document.createElement('script');
	script.src = ONEID_SCRIPT;
	script.onerror = () => {
		send({ outcome: 'failed' });
	};
	script.onload = () => {
		const oneId = win.OneID;
		if (!oneId) {
			send({ outcome: 'failed' });
			return;
		}
		begin(oneId.get({ clientId: ESPN_CLIENT_ID, responderPage: win.location.origin + RESPONDER }));
	};
	win.document.head.appendChild(script);
	win.setTimeout(() => {
		if (!formUp) send({ outcome: 'failed' });
	}, STALL_MS);
}

/** The script the window loads: popupMain's source, run with its window and its setup written out
 * as source, findSession's own among it. */
export function popupSource(
	siteOrigin: string = SITE_ORIGIN,
	signInOrigin: string = ESPN_SIGN_IN_ORIGIN
): string {
	const setup = [
		`siteOrigin: ${JSON.stringify(siteOrigin)}`,
		`signInOrigin: ${JSON.stringify(signInOrigin)}`,
		`alreadySignedInLine: ${JSON.stringify(ALREADY_SIGNED_IN_LINE)}`,
		`find: ${findSession.toString()}`
	].join(', ');
	return `'use strict';\n(${popupMain.toString()})(window, { ${setup} });\n`;
}

/** The window's first line, until Disney's form is up. */
export const OPENING_LINE = "Opening ESPN's sign-in.";

/** The window's page. Its stylesheet and script are our own; Disney's sign-in loads from its CDN.
 * The page's Content-Security-Policy is in web/_headers. */
export const POPUP_PAGE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<meta name="robots" content="noindex" />
		<meta name="referrer" content="no-referrer" />
		<title>Sign in to ESPN</title>
		<link rel="stylesheet" href="/espn-connect.css" />
		<script src="/espn-connect.js" defer></script>
	</head>
	<body>
		<main>
			<h1>Sign in to ESPN</h1>
			<p id="line">${OPENING_LINE}</p>
			<button id="close" type="button">Close this window</button>
		</main>
	</body>
</html>
`;
