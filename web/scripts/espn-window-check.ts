// Checks that the ESPN sign-in window gets past its first line for a member Disney already knows:
// it opens the window from an opener the way the account page does, with a stand-in for the
// session Disney's widget stores on the sign-in origin after a sign-in (every value made up, no
// credential, nothing signed in), and waits for the window to put Disney's form up. Before Lane 88
// that stored session left the widget's init waiting on Disney's guest service, which refuses the
// origin, and the window sat at its first line. Reaches Disney's live CDN, so it is not part of
// `npm test`. Exits non-zero when the window stalls or closes.
// Usage: node scripts/espn-window-check.ts [origin], the sign-in origin by default.
import { chromium } from 'playwright';
import { OPENING_LINE } from '../src/lib/hosts/espn-window.ts';
import { ESPN_SIGN_IN_ORIGIN } from '../src/lib/site/origins.ts';

const DISNEY_TOKEN_COOKIE = 'ESPN-ONESITE.WEB-PROD.token';
/** Disney's stored-token format: version 5, then the token as base64 JSON, then an empty id token. */
const TOKEN_FORMAT_VERSION = '5=';
const HOUR_MS = 3_600_000;
/** Disney's form comes up within the window's own wait (STALL_MS in espn-window.ts) or not at all. */
const FORM_WAIT_MS = 40_000;

const origin = process.argv[2] ?? ESPN_SIGN_IN_ORIGIN;
const now = Date.now();
const standIn = {
	swid: '{00000000-0000-0000-0000-000000000000}',
	access_token: 'stand-in',
	refresh_token: 'stand-in',
	iat: now - HOUR_MS,
	exp: now + 23 * HOUR_MS,
	refresh_exp: now + 720 * HOUR_MS
};
const stored = `${TOKEN_FORMAT_VERSION}${Buffer.from(JSON.stringify(standIn)).toString('base64')}|`;

const browser = await chromium.launch();
try {
	const context = await browser.newContext();
	await context.addCookies([
		{
			name: DISNEY_TOKEN_COOKIE,
			value: stored,
			domain: `.${new URL(origin).hostname}`,
			path: '/'
		}
	]);
	const opener = await context.newPage();
	const [win] = await Promise.all([
		context.waitForEvent('page'),
		opener.evaluate((url) => {
			window.open(url, 'commish-espn', 'popup,width=480,height=720');
		}, `${origin}/espn-connect`)
	]);
	const line = win.locator('#line');
	await line
		.filter({ hasNotText: OPENING_LINE })
		.waitFor({ timeout: FORM_WAIT_MS })
		.catch(() => undefined);
	const said = win.isClosed() ? null : await line.textContent();
	if (said === null || said === OPENING_LINE) {
		process.stderr.write(
			`The window ${said === null ? 'closed' : 'stalled'} at ${origin}/espn-connect.\n`
		);
		process.exitCode = 1;
	} else {
		process.stdout.write(`The window got past its first line: "${said}"\n`);
	}
} finally {
	await browser.close();
}
