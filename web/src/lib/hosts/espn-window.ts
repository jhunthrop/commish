/** The ESPN sign-in window's own script, served from the workers.dev origin (src/routes/espn-connect.js),
 * where no Commish cookie lives. It loads Disney's sign-in for ESPN and hands what Disney answers to
 * its opener with postMessage targeted at the site's origin alone; it never calls our API. The
 * script is popupMain's own source, called with the site's origin, so it must use nothing outside
 * itself. */
import { ESPN_SIGN_IN_ORIGIN, SITE_ORIGIN } from '#lib/site/origins.ts';

/** What the window's messages say they are, shared with the opener (espn-oneid.ts). */
export const MESSAGE_KIND = 'commish-espn';

/** The parts of a window the script uses, so a test can run it. */
export interface PopupWindow {
	opener: { closed: boolean; postMessage: (message: unknown, targetOrigin: string) => void } | null;
	location: { origin: string };
	close: () => void;
	document: {
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
		get: (options: { clientId: string; responderPage: string }) => {
			init: () => Promise<unknown>;
			launchLogin: () => Promise<unknown>;
			getGuest: () => Promise<unknown>;
			on: (event: string, handler: (data: unknown) => void) => void;
		};
	};
}

/** The window's script: run in the sign-in window with its own window, the site's origin it hands
 * Disney's answer to, and the sign-in origin it must be on. Served on any other origin (the same
 * build also serves the site), it loads nothing: Disney's script never runs where our cookies are. */
export function popupMain(win: PopupWindow, siteOrigin: string, signInOrigin: string): void {
	const ONEID_SCRIPT = 'https://cdn.registerdisney.go.com/v4/OneID.js';
	const ESPN_CLIENT_ID = 'ESPN-ONESITE.WEB-PROD';
	const RESPONDER = '/espn-responder';
	const KIND = 'commish-espn';

	const plain = (value: unknown): unknown => {
		try {
			return JSON.parse(JSON.stringify(value ?? null)) as unknown;
		} catch {
			return null;
		}
	};

	/** Hands the outcome to the opener, at the site's origin only, and closes. */
	const send = (outcome: Record<string, unknown>): void => {
		const opener = win.opener;
		if (opener && !opener.closed) opener.postMessage({ kind: KIND, ...outcome }, siteOrigin);
		win.close();
	};

	win.document.getElementById('close')?.addEventListener('click', () => {
		send({ outcome: 'closed' });
	});
	const line = win.document.getElementById('line');
	if (win.location.origin !== signInOrigin) {
		if (line) line.textContent = 'This page opens from your Commish account page.';
		return;
	}

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
		const widget = oneId.get({
			clientId: ESPN_CLIENT_ID,
			responderPage: win.location.origin + RESPONDER
		});
		widget
			.init()
			.then(() => {
				widget.on('login', (login) => {
					void widget
						.getGuest()
						.catch(() => null)
						.then((guest) => {
							send({ outcome: 'signed-in', payload: plain({ login, guest }) });
						});
				});
				return widget.launchLogin();
			})
			.then(() => {
				if (line) line.textContent = 'Sign in on the form above. Closing this window goes back.';
			})
			.catch(() => {
				send({ outcome: 'failed' });
			});
	};
	win.document.head.appendChild(script);
}

/** The script the window loads: popupMain's source, run with its window and the two origins. */
export function popupSource(
	siteOrigin: string = SITE_ORIGIN,
	signInOrigin: string = ESPN_SIGN_IN_ORIGIN
): string {
	const args = [JSON.stringify(siteOrigin), JSON.stringify(signInOrigin)].join(', ');
	return `'use strict';\n(${popupMain.toString()})(window, ${args});\n`;
}

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
			<p id="line">Opening ESPN's sign-in.</p>
			<button id="close" type="button">Close this window</button>
		</main>
	</body>
</html>
`;
