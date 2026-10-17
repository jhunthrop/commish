// The avatar route's answer (Lane 66i re-review M4): the cap enforced while reading a body with no
// stated length, and a failure mid-body answered as a miss, never a server error. Run with `npm test`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AVATAR_MAX_BYTES } from './avatar.ts';
import { readCapped, serveAvatar } from './avatar-serve.ts';

const ID = '2aea7c4ff143abb0f01f2ddbec933afc';

/** A body in chunks of a size, with no stated length, counting what the reader pulled. */
function chunked(
	chunks: number,
	size: number
): { stream: ReadableStream<Uint8Array>; pulled: () => number; cancelled: () => boolean } {
	let sent = 0;
	let cancelled = false;
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent === chunks) {
				controller.close();
				return;
			}
			sent++;
			controller.enqueue(new Uint8Array(size));
		},
		cancel() {
			cancelled = true;
		}
	});
	return { stream, pulled: () => sent, cancelled: () => cancelled };
}

void test('a body under the cap is read whole', async () => {
	const body = chunked(4, 1024);
	const bytes = await readCapped(body.stream, AVATAR_MAX_BYTES);
	assert.equal(bytes?.byteLength, 4096);
});

void test('a body with no stated length stops being read once past the cap', async () => {
	const chunk = 64 * 1024;
	const body = chunked(100, chunk);
	assert.equal(await readCapped(body.stream, AVATAR_MAX_BYTES), null);
	assert.ok(
		body.pulled() <= AVATAR_MAX_BYTES / chunk + 2,
		`pulled ${String(body.pulled())} chunks`
	);
	assert.ok(body.cancelled(), 'the rest of the body is cancelled');
});

const respond = (body: BodyInit | null, headers: Record<string, string>): Response =>
	new Response(body, { status: 200, headers });

void test('an over-cap body with no stated length is a miss', async () => {
	const big = chunked(100, 64 * 1024).stream;
	const res = await serveAvatar('sleeper', ID, {
		fetch: async () => Promise.resolve(respond(big, { 'content-type': 'image/png' }))
	});
	assert.equal(res.status, 502);
});

void test('a body that fails mid-read is a miss, not a server error', async () => {
	let sent = false;
	const failing = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent) {
				controller.error(new DOMException('The operation timed out.', 'TimeoutError'));
				return;
			}
			sent = true;
			controller.enqueue(new Uint8Array(10));
		}
	});
	const res = await serveAvatar('sleeper', ID, {
		fetch: async () => Promise.resolve(respond(failing, { 'content-type': 'image/png' }))
	});
	assert.equal(res.status, 502);
});

void test('a raster under the cap is served sandboxed with its type', async () => {
	const res = await serveAvatar('sleeper', ID, {
		fetch: async () =>
			Promise.resolve(respond(new Uint8Array(512), { 'content-type': 'image/webp' }))
	});
	assert.equal(res.status, 200);
	assert.equal(res.headers.get('content-type'), 'image/webp');
	assert.equal(res.headers.get('content-security-policy'), "default-src 'none'; sandbox");
	assert.equal((await res.arrayBuffer()).byteLength, 512);
});

void test('an SVG, a refused fetch and a stated length over the cap are misses', async () => {
	const svg = await serveAvatar('sleeper', ID, {
		fetch: async () => Promise.resolve(respond('<svg/>', { 'content-type': 'image/svg+xml' }))
	});
	assert.equal(svg.status, 502);
	const refused = await serveAvatar('sleeper', ID, {
		fetch: async () => Promise.reject(new Error('timeout'))
	});
	assert.equal(refused.status, 502);
	const stated = await serveAvatar('sleeper', ID, {
		fetch: async () =>
			Promise.resolve(
				respond('x', {
					'content-type': 'image/png',
					'content-length': String(AVATAR_MAX_BYTES + 1)
				})
			)
	});
	assert.equal(stated.status, 502);
	const missing = await serveAvatar('sleeper', ID, {
		fetch: async () => Promise.resolve(new Response(null, { status: 404 }))
	});
	assert.equal(missing.status, 404);
});
