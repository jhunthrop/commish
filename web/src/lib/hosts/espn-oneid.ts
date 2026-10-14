/** Disney's own sign-in for ESPN, opened on our page: the OneID widget Disney serves for ESPN's client
 * id. The member signs in on Disney's form (two-factor is Disney's to ask), the widget hands the page
 * the session, and the page passes its two ESPN values to the API, which keeps them encrypted. The
 * widget's script is fetched only when the member asks to connect, never in the shell. */

/** Disney's widget script and ESPN's client id with it (Lane 21 spike, 2026-10-14: the widget opens
 * for this client id on a third-party origin). */
const ONEID_SCRIPT = 'https://cdn.registerdisney.go.com/v4/OneID.js';
const ESPN_CLIENT_ID = 'ESPN-ONESITE.WEB-PROD';
/** The page on our origin the widget answers through (static/espn-responder.html). */
const RESPONDER_PATH = '/espn-responder.html';
/** How long the member has to finish Disney's sign-in before the page stops waiting. */
const SIGN_IN_MS = 10 * 60 * 1000;

/** The two ESPN values a session carries, as the API takes them. */
export interface ESPNSession {
	readonly swid: string;
	readonly s2: string;
}

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

/** The part of Disney's widget the page uses. */
interface OneIDWidget {
	init(): Promise<unknown>;
	launchLogin(): Promise<unknown>;
	getGuest(): Promise<unknown>;
	on(event: string, handler: (data: unknown) => void): void;
}

interface OneIDGlobal {
	get(options: { clientId: string; responderPage: string }): OneIDWidget;
}

function loadScript(): Promise<OneIDGlobal> {
	const existing = (window as unknown as { OneID?: OneIDGlobal }).OneID;
	if (existing) return Promise.resolve(existing);
	return new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = ONEID_SCRIPT;
		script.async = true;
		script.onload = () => {
			const loaded = (window as unknown as { OneID?: OneIDGlobal }).OneID;
			if (loaded) resolve(loaded);
			else reject(new Error('Disney sign-in did not load'));
		};
		script.onerror = () => reject(new Error('Disney sign-in did not load'));
		document.head.appendChild(script);
	});
}

/** Open Disney's sign-in and wait for the session it hands back: the two values, or null when the
 * member signed in but the widget did not hand them over (the paste form is the way then). Rejects
 * when the widget cannot open or the member does not finish in ten minutes. */
export async function signInWithDisney(): Promise<ESPNSession | null> {
	const OneID = await loadScript();
	const widget = OneID.get({
		clientId: ESPN_CLIENT_ID,
		responderPage: `${window.location.origin}${RESPONDER_PATH}`
	});
	await widget.init();
	const done = new Promise<unknown>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('Disney sign-in timed out')), SIGN_IN_MS);
		widget.on('login', (data) => {
			clearTimeout(timer);
			resolve(data);
		});
	});
	await widget.launchLogin();
	const data = await done;
	return findSession(data) ?? findSession(await widget.getGuest().catch(() => null));
}
