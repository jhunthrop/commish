// The delete account page (Lane 233, B230): its words pass the copy guard, the departed member's
// name is the API's, the typed confirmation follows the API's rule, and the page's calls ask the API
// nothing signed out and send the typed email to POST /me/delete. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { bannedIn } from '#lib/format/copy-guard.ts';
import { ApiError, type ApiClient, type RequestOptions } from '#lib/api/client.ts';
import { SESSION_CSRF_COOKIE } from '#lib/api/session.ts';
import { confirmed, deleteApi } from './delete-api.ts';
import { ACCOUNT_DELETE_FOOT, DELETE_WORDS, DEPARTED_NAME } from './delete-words.ts';

const GO_STORE = new URL('../../../../api/internal/deletion/store.go', import.meta.url);

function sentences(): string[] {
	return [
		...Object.values(DELETE_WORDS).flatMap((words) =>
			typeof words === 'string' ? [words] : [...words]
		),
		...Object.values(ACCOUNT_DELETE_FOOT),
		DEPARTED_NAME
	];
}

void test('every sentence on the page passes the copy guard and has no em-dash', () => {
	for (const words of sentences()) {
		assert.equal(bannedIn(words), null, words);
		assert.ok(!words.includes('—'), words);
	}
});

void test('the departed member keeps the name the API writes on a kept seat', () => {
	const go = readFileSync(GO_STORE, 'utf8');
	assert.match(go, new RegExp(`const DepartedHandle = "${DEPARTED_NAME}"`));
	assert.ok(DELETE_WORDS.kept.some((line) => line.includes(DEPARTED_NAME)));
});

void test('the account room and the page name the one verb alike', () => {
	assert.equal(ACCOUNT_DELETE_FOOT.verb, DELETE_WORDS.verb);
	assert.equal(DELETE_WORDS.verb, 'Delete account');
});

void test('the confirmation is the email, with no regard to case or the spaces around it', () => {
	assert.equal(confirmed('pat@example.invalid', 'pat@example.invalid'), true);
	assert.equal(confirmed('  PAT@Example.invalid ', 'pat@example.invalid'), true);
	assert.equal(confirmed('', ''), false);
	assert.equal(confirmed('pat', 'pat@example.invalid'), false);
	assert.equal(confirmed('sam@example.invalid', 'pat@example.invalid'), false);
});

interface Asked {
	path: string;
	options: RequestOptions | undefined;
}

function recording(answer: (path: string) => unknown): { client: ApiClient; asked: Asked[] } {
	const asked: Asked[] = [];
	const client = {
		call: (path: string, options?: RequestOptions) => {
			asked.push({ path, options });
			return Promise.resolve(answer(path));
		}
	} as unknown as ApiClient;
	return { client, asked };
}

function withCookie(cookie: string): void {
	Object.defineProperty(globalThis, 'document', { value: { cookie }, configurable: true });
}

void test('signed out the page asks the API nothing', async () => {
	withCookie('commish-theme=dark');
	const { client, asked } = recording(() => null);
	assert.deepEqual(await deleteApi(client, () => true).load(), { kind: 'signed-out' });
	assert.deepEqual(asked, []);
});

void test('a 401 is signed out; an API that cannot be reached is offline or unreachable', async () => {
	withCookie(`${SESSION_CSRF_COOKIE}=csrf-1`);
	const failing = (error: Error): ApiClient =>
		({ call: () => Promise.reject(error) }) as unknown as ApiClient;
	const signedOut = new ApiError(401, { code: 'unauthorized', message: 'Sign in' });
	const down = new ApiError(0, { code: 'offline', message: 'We could not reach Commish' });
	assert.deepEqual(await deleteApi(failing(signedOut), () => true).load(), { kind: 'signed-out' });
	assert.deepEqual(await deleteApi(failing(down), () => true).load(), { kind: 'unreachable' });
	assert.deepEqual(await deleteApi(failing(down), () => false).load(), { kind: 'offline' });
});

void test('signed in the page reads the email, and the verb posts what was typed', async () => {
	withCookie(`${SESSION_CSRF_COOKIE}=csrf-1`);
	const { client, asked } = recording((path) =>
		path === '/me' ? { email: 'pat@example.invalid' } : null
	);
	const api = deleteApi(client, () => true);
	assert.deepEqual(await api.load(), { kind: 'signed-in', email: 'pat@example.invalid' });
	await api.remove('PAT@example.invalid');
	assert.deepEqual(asked[1], {
		path: '/me/delete',
		options: { method: 'POST', body: { email: 'PAT@example.invalid' } }
	});
});
