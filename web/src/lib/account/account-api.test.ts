// The account page's read: a browser with no session is signed out without asking the API, so a
// signed-out visitor's console carries no 401 (Lane 59, L3). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ApiClient } from '#lib/api/client.ts';
import { SESSION_CSRF_COOKIE } from '#lib/api/session.ts';
import { accountApi } from './account-api.ts';

/** A client that records every path it is asked for and answers nothing. */
function recording(): { client: ApiClient; asked: string[] } {
	const asked: string[] = [];
	const client = {
		call: (path: string) => {
			asked.push(path);
			return Promise.reject(new Error('not answered'));
		}
	} as unknown as ApiClient;
	return { client, asked };
}

function withCookie(cookie: string): void {
	Object.defineProperty(globalThis, 'document', { value: { cookie }, configurable: true });
}

void test('with no session the account page is signed out and asks the API nothing', async () => {
	withCookie('commish-theme=dark');
	const { client, asked } = recording();
	assert.deepEqual(await accountApi(client, () => true).load(), { kind: 'signed-out' });
	assert.deepEqual(asked, []);
});

void test('with a session it asks the API who is signed in', async () => {
	withCookie(`${SESSION_CSRF_COOKIE}=csrf-1`);
	const { client, asked } = recording();
	await assert.rejects(accountApi(client, () => true).load());
	assert.deepEqual(asked, ['/me']);
});
