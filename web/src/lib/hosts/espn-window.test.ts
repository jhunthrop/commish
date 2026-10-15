// The ESPN sign-in window hands Disney's answer to the site's origin alone, and runs nowhere else
// but the workers.dev origin: run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESPN_SIGN_IN_ORIGIN, SITE_ORIGIN } from '../site/origins.ts';
import { MESSAGE_KIND, popupMain, popupSource, type PopupWindow } from './espn-window.ts';

interface Rig {
	readonly win: PopupWindow;
	readonly posted: { message: unknown; target: string }[];
	readonly appended: unknown[];
	click: () => void;
	closed: boolean;
}

function rig(origin: string): Rig {
	const posted: { message: unknown; target: string }[] = [];
	const appended: unknown[] = [];
	let onClick: () => void = () => undefined;
	const state: Rig = {
		posted,
		appended,
		closed: false,
		click: () => {
			onClick();
		},
		win: {
			opener: {
				closed: false,
				postMessage: (message, target) => posted.push({ message, target })
			},
			location: { origin },
			close: () => {
				state.closed = true;
			},
			document: {
				getElementById: (id) => ({
					textContent: '',
					addEventListener: (_event, handler) => {
						if (id === 'close') onClick = handler;
					}
				}),
				createElement: () => ({ src: '', onload: null, onerror: null }),
				head: { appendChild: (node) => appended.push(node) }
			}
		}
	};
	return state;
}

void test('on the sign-in origin the window loads Disney and hands its outcome to the site alone', () => {
	const r = rig(ESPN_SIGN_IN_ORIGIN);
	popupMain(r.win, SITE_ORIGIN, ESPN_SIGN_IN_ORIGIN);
	assert.equal(r.appended.length, 1);
	r.click();
	assert.deepEqual(r.posted, [
		{ message: { kind: MESSAGE_KIND, outcome: 'closed' }, target: SITE_ORIGIN }
	]);
	assert.equal(r.closed, true);
});

void test('on any other origin, the site among them, the window loads nothing', () => {
	for (const origin of [SITE_ORIGIN, 'https://evil.example']) {
		const r = rig(origin);
		popupMain(r.win, SITE_ORIGIN, ESPN_SIGN_IN_ORIGIN);
		assert.equal(r.appended.length, 0, origin);
	}
});

void test('the served script names both origins and never a wildcard target', () => {
	const source = popupSource();
	assert.ok(source.includes(JSON.stringify(SITE_ORIGIN)));
	assert.ok(source.includes(JSON.stringify(ESPN_SIGN_IN_ORIGIN)));
	assert.ok(!source.includes("'*'") && !source.includes('"*"'));
	assert.notEqual(new URL(SITE_ORIGIN).hostname, new URL(ESPN_SIGN_IN_ORIGIN).hostname);
	assert.ok(!new URL(ESPN_SIGN_IN_ORIGIN).hostname.endsWith('trycommish.app'));
});
