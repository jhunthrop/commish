// The ESPN sign-in window hands Disney's answer to the site's origin alone, runs nowhere else but
// the workers.dev origin, and hands over an existing Disney session the way it hands over a fresh
// sign-in: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Script } from 'node:vm';
import { ESPN_SIGN_IN_ORIGIN, SITE_ORIGIN } from '../site/origins.ts';
import { findSession } from './espn-session.ts';
import {
	ALREADY_SIGNED_IN_LINE,
	MESSAGE_KIND,
	popupMain,
	popupSource,
	type PopupWidget,
	type PopupWindow
} from './espn-window.ts';

const SWID = '{00000001-0000-4000-8000-000000000001}';
const S2 = 'AEB'.repeat(30);
const GUEST_WITH_SESSION = { profile: { swid: SWID }, s2: S2 };
const GUEST_WITHOUT_S2 = { profile: { swid: SWID } };
const SETUP = {
	siteOrigin: SITE_ORIGIN,
	signInOrigin: ESPN_SIGN_IN_ORIGIN,
	find: findSession,
	alreadySignedInLine: ALREADY_SIGNED_IN_LINE
};

interface Posted {
	readonly message: Record<string, unknown>;
	readonly target: string;
}

interface ScriptTag {
	src: string;
	onload: (() => void) | null;
	onerror: (() => void) | null;
}

interface Rig {
	readonly win: PopupWindow;
	readonly posted: Posted[];
	readonly appended: ScriptTag[];
	readonly line: { textContent: string | null };
	/** Every cookie the window wrote, in order, and what had been written when Disney's script went
	 * in. */
	readonly cookiesWritten: string[];
	readonly removedKeys: string[];
	readonly writtenBeforeScript: string[];
	readonly timers: Timer[];
	/** Whether the close button still has its listener. */
	readonly closeListening: () => boolean;
	click: () => void;
	closed: boolean;
}

/** Disney's session as its widget keeps it on the sign-in origin: the names its own sign-out
 * (responder.js, guest.logout) expires, and the guest it caches. */
const DISNEY_COOKIES = [
	'ESPN-ONESITE.WEB-PROD.ab2',
	'ESPN-ONESITE.WEB-PROD.idn',
	'ESPN-ONESITE.WEB-PROD.rt',
	'ESPN-ONESITE.WEB-PROD.token',
	'ESPN-ONESITE.WEB-PROD.ts',
	'ESPN-ONESITE.WEB-PROD-ac'
];
const DISNEY_GUEST_KEY = 'ESPN-ONESITE.WEB-PROD.guest';

interface Timer {
	readonly ms: number;
	readonly run: () => void;
	cleared: boolean;
}

/** The waits the window set and has not cleared. */
function live(r: Rig): Timer[] {
	return r.timers.filter((timer) => !timer.cleared);
}

function rig(origin: string): Rig {
	const posted: Posted[] = [];
	const appended: ScriptTag[] = [];
	const line = { textContent: '' as string | null };
	const cookiesWritten: string[] = [];
	const removedKeys: string[] = [];
	const writtenBeforeScript: string[] = [];
	const timers: Timer[] = [];
	let onClick: (() => void) | null = null;
	const state: Rig = {
		posted,
		appended,
		line,
		cookiesWritten,
		removedKeys,
		writtenBeforeScript,
		timers,
		closeListening: () => onClick !== null,
		closed: false,
		click: () => {
			onClick?.();
		},
		win: {
			opener: {
				closed: false,
				postMessage: (message, target) => {
					posted.push({ message: message as Record<string, unknown>, target });
				}
			},
			location: { origin, hostname: new URL(origin).hostname },
			close: () => {
				state.closed = true;
			},
			setTimeout: (handler, ms) => {
				const timer: Timer = { ms, run: handler, cleared: false };
				timers.push(timer);
				return timer;
			},
			clearTimeout: (handle) => {
				const timer = timers.find((each) => each === handle);
				if (timer) timer.cleared = true;
			},
			localStorage: {
				removeItem: (key) => {
					removedKeys.push(key);
				}
			},
			document: {
				set cookie(written: string) {
					cookiesWritten.push(written);
				},
				getElementById: (id) =>
					id === 'line'
						? Object.assign(line, {
								addEventListener: () => undefined,
								removeEventListener: () => undefined
							})
						: {
								textContent: '',
								addEventListener: (_event, handler) => {
									if (id === 'close') onClick = handler;
								},
								removeEventListener: (_event, handler) => {
									if (id === 'close' && onClick === handler) onClick = null;
								}
							},
				createElement: () => {
					const script: ScriptTag = { src: '', onload: null, onerror: null };
					appended.push(script);
					return script;
				},
				head: {
					appendChild: () => {
						writtenBeforeScript.push(...cookiesWritten);
					}
				}
			}
		}
	};
	return state;
}

interface WidgetScript {
	readonly loggedIn: boolean;
	/** What getGuest answers, call by call; the last answer repeats. */
	readonly guests: readonly unknown[];
	readonly launchRejects?: unknown;
	readonly initRejects?: unknown;
	/** init never settles, as it does when Disney's guest service will not answer this origin. */
	readonly initHangs?: boolean;
	readonly logoutRejects?: unknown;
	/** getGuest's first call rejects, as Disney's guest service can. */
	readonly guestRejectsFirst?: boolean;
	/** getGuest never answers, as the guest service that refuses this origin can leave it. */
	readonly guestHangs?: boolean;
}

interface WidgetRig {
	readonly widget: PopupWidget;
	readonly calls: string[];
	readonly getGuestArgs: unknown[][];
	emit: (event: string, data?: unknown) => void;
	/** How many widget listeners are still on. */
	listening: () => number;
}

function stubWidget(script: WidgetScript): WidgetRig {
	const calls: string[] = [];
	const getGuestArgs: unknown[][] = [];
	const handlers = new Map<string, ((data: unknown) => void)[]>();
	const emit = (event: string, data?: unknown): void => {
		for (const handler of handlers.get(event) ?? []) handler(data);
	};
	let guestCall = 0;
	const widget: PopupWidget = {
		init: () => {
			calls.push('init');
			// Disney's widget rejects with plain objects ({ errorCategory, errorCodes }), never an Error.
			// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
			if (script.initRejects !== undefined) return Promise.reject(script.initRejects);
			if (script.initHangs === true) return new Promise(() => undefined);
			return Promise.resolve({ loggedIn: script.loggedIn, guest: null });
		},
		launchLogin: () => {
			calls.push('launchLogin');
			// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
			if (script.launchRejects !== undefined) return Promise.reject(script.launchRejects);
			return Promise.resolve();
		},
		logout: () => {
			calls.push('logout');
			// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
			if (script.logoutRejects !== undefined) return Promise.reject(script.logoutRejects);
			emit('logout', 'unknown');
			return Promise.resolve();
		},
		getGuest: (...args: unknown[]) => {
			calls.push('getGuest');
			getGuestArgs.push(args);
			if (script.guestHangs === true) return new Promise(() => undefined);
			if (script.guestRejectsFirst === true && guestCall === 0) {
				guestCall += 1;
				// eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
				return Promise.reject({ errorCodes: 'UNABLE_TO_RETRIEVE_GUEST_DATA' });
			}
			const answer = script.guests[Math.min(guestCall, script.guests.length - 1)];
			guestCall += 1;
			return Promise.resolve(answer);
		},
		on: (event, handler) => {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		off: (event, handler) => {
			handlers.set(
				event,
				(handlers.get(event) ?? []).filter((each) => each !== handler)
			);
		}
	};
	const listening = (): number =>
		[...handlers.values()].reduce((count, list) => count + list.length, 0);
	return { widget, calls, getGuestArgs, emit, listening };
}

/** Runs the window with a stubbed Disney widget and lets its promises settle. */
async function run(script: WidgetScript): Promise<{ r: Rig; w: WidgetRig }> {
	const r = rig(ESPN_SIGN_IN_ORIGIN);
	const w = stubWidget(script);
	popupMain(r.win, SETUP);
	r.win.OneID = { get: () => w.widget };
	r.appended[0]?.onload?.();
	await settle();
	return { r, w };
}

async function settle(): Promise<void> {
	for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function finals(r: Rig): Posted[] {
	return r.posted.filter((p) => p.message.outcome !== 'seen');
}

/** The window's one last message. */
function handedOver(r: Rig): Posted {
	const [last, ...more] = finals(r);
	assert.ok(last, 'the window sent its last message');
	assert.equal(more.length, 0, 'the window sent one last message');
	return last;
}

void test('on the sign-in origin the window loads Disney and hands its outcome to the site alone', () => {
	const r = rig(ESPN_SIGN_IN_ORIGIN);
	popupMain(r.win, SETUP);
	assert.equal(r.appended.length, 1);
	r.click();
	assert.deepEqual(r.posted, [
		{ message: { kind: MESSAGE_KIND, outcome: 'closed', seen: [] }, target: SITE_ORIGIN }
	]);
	assert.equal(r.closed, true);
});

void test('on any other origin, the site among them, the window loads nothing', () => {
	for (const origin of [SITE_ORIGIN, 'https://evil.example']) {
		const r = rig(origin);
		popupMain(r.win, SETUP);
		assert.equal(r.appended.length, 0, origin);
	}
});

void test("Disney's stored session on the sign-in origin is forgotten before its script loads", () => {
	const r = rig(ESPN_SIGN_IN_ORIGIN);
	popupMain(r.win, SETUP);
	const host = new URL(ESPN_SIGN_IN_ORIGIN).hostname;
	for (const name of DISNEY_COOKIES) {
		const expired = r.writtenBeforeScript.filter(
			(written) => written.startsWith(`${name}=;`) && written.includes('expires=Thu, 01 Jan 1970')
		);
		assert.ok(
			expired.some((written) => !written.includes('domain=')),
			`${name} expired as a host cookie`
		);
		assert.ok(
			expired.some((written) => written.includes(`domain=.${host}`)),
			`${name} expired on the domain Disney's responder sets it on`
		);
	}
	assert.deepEqual(r.removedKeys, [DISNEY_GUEST_KEY]);
	assert.equal(r.appended.length, 1, "then Disney's script goes in");
});

void test('on any other origin the window forgets nothing and writes no cookie', () => {
	const r = rig(SITE_ORIGIN);
	popupMain(r.win, SETUP);
	assert.deepEqual(r.cookiesWritten, []);
	assert.deepEqual(r.removedKeys, []);
});

void test('storage the browser refuses does not stop the window', () => {
	const r = rig(ESPN_SIGN_IN_ORIGIN);
	r.win.localStorage = {
		removeItem: () => {
			throw new Error('SecurityError');
		}
	};
	popupMain(r.win, SETUP);
	assert.equal(r.appended.length, 1);
});

void test("a widget that never opens Disney's form ends the window as a sign-in that did not open", async () => {
	const { r, w } = await run({ loggedIn: false, guests: [null], initHangs: true });
	assert.deepEqual(w.calls, ['init']);
	assert.equal(finals(r).length, 0, 'nothing final before the wait is up');
	const [stall, ...more] = r.timers;
	assert.ok(stall, 'the window set one wait');
	assert.equal(more.length, 0);
	assert.ok(
		stall.ms >= 15_000 && stall.ms <= 60_000,
		`a wait a person would sit through: ${stall.ms}`
	);
	stall.run();
	const handed = handedOver(r);
	assert.deepEqual(handed.message, { kind: MESSAGE_KIND, outcome: 'failed', seen: [] });
	assert.equal(r.closed, true);
});

void test("once Disney's form is up the wait never ends the window", async () => {
	const { r } = await run({ loggedIn: false, guests: [null] });
	assert.deepEqual(live(r), [], 'the wait is cleared once the form is up');
	assert.equal(finals(r).length, 0);
	assert.equal(r.closed, false);
});

/** The login event as Disney sends it after a sign-in on its form, the two values in it. */
const LOGIN_WITH_SESSION = { token: { swid: SWID }, s2: S2 };

for (const [name, script] of [
	['rejects', { guestRejectsFirst: true, guests: [null] }],
	['answers nothing', { guests: [null] }]
] as const) {
	void test(`a login that carries the pair hands it over at once while the guest read ${name}`, async () => {
		const { r, w } = await run({ loggedIn: false, ...script });
		w.emit('login', LOGIN_WITH_SESSION);
		await settle();
		assert.deepEqual(w.calls, ['init', 'launchLogin'], 'no guest read waited on');
		const handed = handedOver(r);
		assert.equal(handed.target, SITE_ORIGIN);
		assert.equal(handed.message.outcome, 'signed-in');
		assert.deepEqual(handed.message.payload, { swid: SWID, s2: S2 }, 'the pair alone');
		assert.equal(r.closed, true);
	});
}

void test('a login without the pair whose guest read never answers ends at the wait as a sign-in that did not open', async () => {
	const { r, w } = await run({ loggedIn: false, guests: [null], guestHangs: true });
	w.emit('login', { token: {} });
	await settle();
	assert.deepEqual(w.calls, ['init', 'launchLogin', 'getGuest']);
	assert.equal(finals(r).length, 0, 'nothing final before the wait is up');
	const [wait, ...more] = live(r);
	assert.ok(wait, 'the login re-armed the wait');
	assert.equal(more.length, 0);
	wait.run();
	const handed = handedOver(r);
	assert.deepEqual(handed.message, {
		kind: MESSAGE_KIND,
		outcome: 'failed',
		seen: ['init-signed-out', 'login']
	});
	assert.equal(r.closed, true);
});

void test('the last message clears the wait and takes every listener off', async () => {
	const { r, w } = await run({ loggedIn: false, guests: [null] });
	assert.ok(w.listening() > 0 && r.closeListening());
	w.emit('login', LOGIN_WITH_SESSION);
	await settle();
	handedOver(r);
	assert.deepEqual(live(r), []);
	assert.equal(w.listening(), 0, 'no widget listener left');
	assert.equal(r.closeListening(), false, 'the close button let go');
});

void test('a guest already signed in is handed over from the widget, with no sign-in form', async () => {
	const { r, w } = await run({ loggedIn: true, guests: [GUEST_WITH_SESSION] });
	assert.deepEqual(w.calls, ['init', 'getGuest']);
	assert.deepEqual(w.getGuestArgs[0], [true, { forceRefresh: true }]);
	const handed = handedOver(r);
	assert.equal(handed.target, SITE_ORIGIN);
	assert.equal(handed.message.outcome, 'signed-in');
	assert.deepEqual(handed.message.seen, ['init-signed-in']);
	assert.deepEqual(handed.message.payload, { swid: SWID, s2: S2 }, 'the pair alone, no guest');
	assert.equal(r.closed, true);
});

void test('a guest already signed in whose session the widget keeps is signed out and asked to sign in', async () => {
	const { r, w } = await run({
		loggedIn: true,
		guests: [GUEST_WITHOUT_S2, GUEST_WITH_SESSION]
	});
	assert.deepEqual(w.calls, ['init', 'getGuest', 'logout', 'launchLogin']);
	assert.equal(r.line.textContent, ALREADY_SIGNED_IN_LINE);
	assert.equal(finals(r).length, 0, 'nothing final while the form is up');
	assert.equal(r.closed, false);

	w.emit('login', { token: {} });
	await settle();
	const handed = handedOver(r);
	assert.equal(handed.message.outcome, 'signed-in');
	assert.deepEqual(handed.message.seen, ['init-signed-in', 'logout', 'login']);
	assert.deepEqual(handed.message.payload, { swid: SWID, s2: S2 }, 'the pair alone, no guest');
});

void test('a guest signed out gets the form, and signing in hands the session over', async () => {
	const { r, w } = await run({ loggedIn: false, guests: [GUEST_WITH_SESSION] });
	assert.deepEqual(w.calls, ['init', 'launchLogin']);
	assert.equal(finals(r).length, 0);
	w.emit('login', { token: {} });
	await settle();
	const handed = handedOver(r);
	assert.equal(handed.message.outcome, 'signed-in');
	assert.deepEqual(handed.message.seen, ['init-signed-out', 'login']);
	assert.deepEqual(handed.message.payload, { swid: SWID, s2: S2 }, 'the pair alone, no guest');
});

void test("a widget refusal is handed over as an error in the widget's own words", async () => {
	const { r } = await run({
		loggedIn: false,
		guests: [null],
		launchRejects: { errorCategory: 'FAILURE_BY_DESIGN', errorCodes: 'Session already established' }
	});
	const handed = handedOver(r);
	assert.deepEqual(handed.message, {
		kind: MESSAGE_KIND,
		outcome: 'error',
		reason: 'Session already established',
		seen: ['init-signed-out']
	});
	assert.equal(r.closed, true);
});

void test('a guest read that fails on the signed-in path signs the guest out and opens the form', async () => {
	const { r, w } = await run({
		loggedIn: true,
		guests: [GUEST_WITH_SESSION],
		guestRejectsFirst: true
	});
	assert.deepEqual(w.calls, ['init', 'getGuest', 'logout', 'launchLogin']);
	assert.equal(r.line.textContent, ALREADY_SIGNED_IN_LINE);
	assert.equal(finals(r).length, 0);
});

void test('a sign-out the widget refuses ends as an error in its codes', async () => {
	const { r, w } = await run({
		loggedIn: true,
		guests: [GUEST_WITHOUT_S2],
		logoutRejects: { errorCodes: ['Session not established'] }
	});
	assert.deepEqual(w.calls, ['init', 'getGuest', 'logout']);
	const handed = handedOver(r);
	assert.equal(handed.message.outcome, 'error');
	assert.equal(handed.message.reason, 'Session not established');
});

void test("a refusal's free-text message never crosses, only its codes", async () => {
	const { r } = await run({
		loggedIn: false,
		guests: [null],
		launchRejects: new Error('typed by someone@example.com')
	});
	const handed = handedOver(r);
	assert.equal(handed.message.reason, 'unknown');
	assert.ok(!JSON.stringify(r.posted).includes('example.com'));
});

void test('a login whose guest lacks a value hands over no payload at all', async () => {
	const { r, w } = await run({
		loggedIn: false,
		guests: [{ profile: { swid: SWID, email: 'm@x' } }]
	});
	w.emit('login', { token: {} });
	await settle();
	const handed = handedOver(r);
	assert.equal(handed.message.outcome, 'signed-in');
	assert.equal(handed.message.payload, null);
});

void test('every widget event is posted as it is seen, without its data', async () => {
	const { r, w } = await run({ loggedIn: false, guests: [null] });
	w.emit('error', { secret: 'never posted' });
	const progress = r.posted.filter((p) => p.message.outcome === 'seen');
	assert.deepEqual(
		progress.map((p) => p.message.seen),
		[['init-signed-out'], ['init-signed-out', 'error']]
	);
	assert.ok(!JSON.stringify(r.posted).includes('never posted'));
});

void test('the served script runs, names both origins and never a wildcard target', () => {
	const source = popupSource();
	assert.doesNotThrow(() => new Script(source));
	assert.ok(source.includes(JSON.stringify(SITE_ORIGIN)));
	assert.ok(source.includes(JSON.stringify(ESPN_SIGN_IN_ORIGIN)));
	assert.ok(!source.includes("'*'") && !source.includes('"*"'));
	assert.notEqual(new URL(SITE_ORIGIN).hostname, new URL(ESPN_SIGN_IN_ORIGIN).hostname);
	assert.ok(!new URL(ESPN_SIGN_IN_ORIGIN).hostname.endsWith('trycommish.app'));
});
