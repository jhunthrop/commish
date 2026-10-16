// The post-deploy cache purge: finds the zone by name, purges everything, and fails loudly.
// Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { purgeZoneCache } from './purge.ts';

interface Call {
	url: string;
	method: string;
	body: string | null;
}

function cloudflare(calls: Call[], answers: { status: number; body: unknown }[]): typeof fetch {
	return (input, init) => {
		calls.push({
			url: input instanceof Request ? input.url : input.toString(),
			method: init?.method ?? 'GET',
			body: typeof init?.body === 'string' ? init.body : null
		});
		const answer = answers[calls.length - 1] ?? { status: 500, body: {} };
		return Promise.resolve(Response.json(answer.body, { status: answer.status }));
	};
}

const ZONE = { status: 200, body: { success: true, result: [{ id: 'zone123' }] } };

void test('the zone is found by name and purged whole', async () => {
	const calls: Call[] = [];
	const line = await purgeZoneCache(
		cloudflare(calls, [ZONE, { status: 200, body: { success: true, result: { id: 'z' } } }]),
		'token',
		'trycommish.app'
	);
	assert.match(line, /Purged the edge cache of trycommish\.app \(zone zone123\)/);
	assert.deepEqual(calls, [
		{
			url: 'https://api.cloudflare.com/client/v4/zones?name=trycommish.app',
			method: 'GET',
			body: null
		},
		{
			url: 'https://api.cloudflare.com/client/v4/zones/zone123/purge_cache',
			method: 'POST',
			body: '{"purge_everything":true}'
		}
	]);
});

void test('a refused purge fails and names the permission to add', async () => {
	const refusal = {
		status: 403,
		body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] }
	};
	await assert.rejects(
		purgeZoneCache(cloudflare([], [ZONE, refusal]), 'token', 'trycommish.app'),
		/purge for trycommish\.app failed \(needs Zone > Cache Purge > Purge\).*10000 Authentication error/
	);
});

void test('a zone the token cannot see fails before any purge', async () => {
	const calls: Call[] = [];
	const none = { status: 200, body: { success: true, result: [] } };
	await assert.rejects(
		purgeZoneCache(cloudflare(calls, [none]), 'token', 'trycommish.app'),
		/no zone named trycommish\.app/
	);
	assert.equal(calls.length, 1);
});
