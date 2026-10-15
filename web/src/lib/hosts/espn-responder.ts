/** The page Disney's sign-in widget answers the sign-in window through (its responderPage), served
 * like the window itself (src/routes/espn-responder.html, src/routes/espn-responder.js): our own
 * script appends Disney's responder only on the workers.dev origin, which carries no Commish cookie.
 * The same build serves the site, and there the page loads nothing (Lane 21 review, NEW-1).
 * responderMain is served as its own source, so it must use nothing outside itself. */
import { ESPN_SIGN_IN_ORIGIN } from '#lib/site/origins.ts';

/** The parts of a window the responder script uses, so a test can run it. */
export interface ResponderWindow {
	location: { origin: string };
	document: {
		createElement: (tag: 'script') => { src: string };
		head: { appendChild: (node: unknown) => unknown };
	};
}

/** The responder's script: on the sign-in origin it appends Disney's responder, anywhere else
 * nothing. */
export function responderMain(win: ResponderWindow, signInOrigin: string): void {
	const RESPONDER_SCRIPT = 'https://cdn.registerdisney.go.com/v4/responder.js';
	if (win.location.origin !== signInOrigin) return;
	const script = win.document.createElement('script');
	script.src = RESPONDER_SCRIPT;
	win.document.head.appendChild(script);
}

/** The script the responder page loads: responderMain's source, run with its window and the
 * sign-in origin. */
export function responderSource(signInOrigin: string = ESPN_SIGN_IN_ORIGIN): string {
	return `'use strict';\n(${responderMain.toString()})(window, ${JSON.stringify(signInOrigin)});\n`;
}

/** The responder's page. Its Content-Security-Policy is in web/_headers. The script is not deferred:
 * Disney's responder must be in place as the page loads. */
export const RESPONDER_PAGE = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="robots" content="noindex" />
		<meta name="referrer" content="no-referrer" />
		<title>ESPN sign-in</title>
		<script src="/espn-responder.js"></script>
	</head>
	<body></body>
</html>
`;
