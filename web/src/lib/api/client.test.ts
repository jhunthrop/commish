// The client's two "can't reach" cases from the launch audit: a hung API is cut off at the call's
// wait (G1), and Google's front end answering for a down service reads as unreachable, not as an
// answer we did not expect (G2). Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ApiError, CLIENT_CODES, apiClient } from './client.ts';
import { REQUEST_TIMEOUT_MS, type RequestTimeouts } from './config.ts';

const ORIGIN = 'https://api.example.test';
/** Short waits, each far apart, so a test tells which one cut the call off. */
const WAITS: RequestTimeouts = { read: 20, write: 120, platform: 240 };
/** A client with no wait would hold these tests for ever; this fails them instead. */
const HANG = { timeout: 2_000 };

Object.defineProperty(globalThis, 'document', { value: { cookie: '' }, configurable: true });

function envelope(data: unknown, status = 200): Response {
	return new Response(JSON.stringify({ ok: true, data, error: null }), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});
}

/** A fetch that answers `respond` after `ms`, or rejects with the signal's reason if it aborts first,
 * as the browser's does. */
function slow(ms: number, respond: () => Response = () => envelope('late')): typeof fetch {
	return (_input, init) =>
		new Promise<Response>((resolve, reject) => {
			const signal = init?.signal;
			const timer = setTimeout(() => {
				resolve(respond());
			}, ms);
			signal?.addEventListener('abort', () => {
				clearTimeout(timer);
				reject(signal.reason as Error);
			});
		});
}

/** A fetch whose answer's headers arrive at once and whose body never ends until the signal aborts. */
const stalledBody: typeof fetch = (_input, init) => {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			// AbortSignal.timeout's timer does not hold Node's event loop open; this one does, until the
			// abort, as an open connection would.
			const open = setTimeout(() => undefined, 10_000);
			init?.signal?.addEventListener('abort', () => {
				clearTimeout(open);
				controller.error(init.signal?.reason);
			});
		}
	});
	return Promise.resolve(new Response(body, { status: 200 }));
};

function isUnreachable(error: unknown): boolean {
	return error instanceof ApiError && error.code === CLIENT_CODES.offline && error.status === 0;
}

function html(status: number): typeof fetch {
	return () =>
		Promise.resolve(
			new Response('<html><body>Error: Server Error</body></html>', {
				status,
				headers: { 'Content-Type': 'text/html' }
			})
		);
}

void test("the site waits 8 s for a read, 20 s for a write, 45 s for a platform's live read", () => {
	assert.deepEqual(REQUEST_TIMEOUT_MS, { read: 8_000, write: 20_000, platform: 45_000 });
});

void test(
	'a read the API never answers is cut off at the read wait and reads as unreachable',
	HANG,
	async () => {
		const client = apiClient(ORIGIN, slow(10_000), WAITS);
		await assert.rejects(client.call('/me'), isUnreachable);
	}
);

void test('a read answered after the read wait (and before the write wait) is already cut off', async () => {
	const client = apiClient(ORIGIN, slow(WAITS.read * 3), WAITS);
	await assert.rejects(client.call('/me'), isUnreachable);
});

void test('a write waits the write wait, so an answer after the read wait still lands', async () => {
	const client = apiClient(
		ORIGIN,
		slow(WAITS.read * 3, () => envelope({ saved: true })),
		WAITS
	);
	assert.deepEqual(await client.call('/sheets', { method: 'POST', body: {} }), { saved: true });
});

void test(
	'a write the API never answers reads as unreachable at the write wait',
	HANG,
	async () => {
		const client = apiClient(ORIGIN, slow(10_000), WAITS);
		await assert.rejects(client.call('/sheets', { method: 'POST', body: {} }), isUnreachable);
	}
);

void test('a call that reads a platform live waits the platform wait', async () => {
	const client = apiClient(
		ORIGIN,
		slow(WAITS.write * 1.5, () => envelope([])),
		WAITS
	);
	assert.deepEqual(await client.call('/hosts/espn/leagues', { timeout: 'platform' }), []);
});

void test(
	'an answer whose body stalls past the wait reads as unreachable, not malformed',
	HANG,
	async () => {
		await assert.rejects(apiClient(ORIGIN, stalledBody, WAITS).call('/me'), isUnreachable);
	}
);

void test('an answer in time is the payload', async () => {
	const client = apiClient(
		ORIGIN,
		slow(1, () => envelope({ id: 'a' })),
		WAITS
	);
	assert.deepEqual(await client.call('/me'), { id: 'a' });
});

for (const status of [502, 503, 504]) {
	void test(`Google's front end page with ${String(status)} reads as unreachable`, async () => {
		await assert.rejects(apiClient(ORIGIN, html(status), WAITS).call('/me'), isUnreachable);
	});
}

for (const status of [500, 501, 505]) {
	void test(`a page with ${String(status)}, outside 502 to 504, still reads as malformed`, async () => {
		await assert.rejects(apiClient(ORIGIN, html(status), WAITS).call('/me'), (error: unknown) => {
			return (
				error instanceof ApiError &&
				error.code === CLIENT_CODES.malformed &&
				error.status === status
			);
		});
	});
}

void test('a 200 that is not the envelope reads as malformed', async () => {
	await assert.rejects(apiClient(ORIGIN, html(200), WAITS).call('/me'), (error: unknown) => {
		return (
			error instanceof ApiError && error.code === CLIENT_CODES.malformed && error.status === 200
		);
	});
});

void test("the API's own 503 envelope keeps its words", async () => {
	const refusal = (): Promise<Response> =>
		Promise.resolve(
			new Response(
				JSON.stringify({
					ok: false,
					data: null,
					error: { code: 'unavailable', message: 'Checkout is not open yet' }
				}),
				{ status: 503 }
			)
		);
	await assert.rejects(apiClient(ORIGIN, refusal, WAITS).call('/billing/checkout'), {
		status: 503,
		code: 'unavailable',
		message: 'Checkout is not open yet'
	});
});

void test('a 204 is done with nothing to say: null, not an answer we did not expect', async () => {
	const done: typeof fetch = () => Promise.resolve(new Response(null, { status: 204 }));
	const answer = await apiClient(ORIGIN, done, WAITS).call<null>('/me/delete', {
		method: 'POST',
		body: { email: 'pat@example.invalid' }
	});
	assert.equal(answer, null);
});

void test('a network failure reads as unreachable', async () => {
	const down: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));
	await assert.rejects(apiClient(ORIGIN, down, WAITS).call('/me'), isUnreachable);
});
