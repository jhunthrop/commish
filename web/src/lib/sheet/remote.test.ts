// The sheet's account read: with no session the sheet stays in this browser without asking the
// API, so a signed-out reader's console carries no 401 (Lane 59, L3). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ApiClient } from '#lib/api/client.ts';
import { SESSION_CSRF_COOKIE } from '#lib/api/session.ts';
import { sheetsApi } from './remote.ts';
import { isUnauthorized } from './sync.ts';

function recording(): { client: ApiClient; asked: string[] } {
	const asked: string[] = [];
	const client = {
		call: (path: string) => {
			asked.push(path);
			return Promise.resolve({});
		}
	} as unknown as ApiClient;
	return { client, asked };
}

function withCookie(cookie: string): void {
	Object.defineProperty(globalThis, 'document', { value: { cookie }, configurable: true });
}

void test('with no session the sheet reads as signed out and the API is never asked', async () => {
	withCookie('');
	const { client, asked } = recording();
	const error: unknown = await sheetsApi(client)
		.me()
		.then(
			() => null,
			(reason: unknown) => reason
		);
	assert.ok(isUnauthorized(error));
	assert.deepEqual(asked, []);
});

void test('with a session it asks who is signed in', async () => {
	withCookie(`${SESSION_CSRF_COOKIE}=csrf-1`);
	const { client, asked } = recording();
	await sheetsApi(client).me();
	assert.deepEqual(asked, ['/me']);
});
