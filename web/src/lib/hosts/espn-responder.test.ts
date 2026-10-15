// Disney's responder runs only on the workers.dev origin, never where the site's cookies are: run
// with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESPN_SIGN_IN_ORIGIN, SITE_ORIGIN } from '../site/origins.ts';
import { responderMain, responderSource } from './espn-responder.ts';

function rig(origin: string): { appended: { src: string }[]; run: () => void } {
	const appended: { src: string }[] = [];
	return {
		appended,
		run: () => {
			responderMain(
				{
					location: { origin },
					document: {
						createElement: () => ({ src: '' }),
						head: {
							appendChild: (node) => {
								appended.push(node as { src: string });
								return node;
							}
						}
					}
				},
				ESPN_SIGN_IN_ORIGIN
			);
		}
	};
}

void test('on the sign-in origin the responder appends Disney responder script', () => {
	const r = rig(ESPN_SIGN_IN_ORIGIN);
	r.run();
	assert.deepEqual(
		r.appended.map((s) => s.src),
		['https://cdn.registerdisney.go.com/v4/responder.js']
	);
});

void test('off the sign-in origin, the site among them, the responder loads nothing', () => {
	for (const origin of [SITE_ORIGIN, 'https://www.trycommish.app', 'https://evil.example']) {
		const r = rig(origin);
		r.run();
		assert.equal(r.appended.length, 0, origin);
	}
});

void test('the served responder script names the sign-in origin', () => {
	assert.ok(responderSource().includes(JSON.stringify(ESPN_SIGN_IN_ORIGIN)));
});
