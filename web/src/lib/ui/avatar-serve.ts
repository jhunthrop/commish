/** The avatar route's answer, apart from SvelteKit so it is tested on its own: the platform's image
 * fetched with a timeout and read with a running count, so a body with no stated length is never
 * read past the cap; any failure, before the body or in it, answers as a miss, and the team's
 * initials stand in. The route caches what this answers. */
import {
	AVATAR_HEADERS,
	AVATAR_MAX_BYTES,
	AVATAR_TIMEOUT_MS,
	rasterType,
	tooLarge,
	upstreamAvatarUrl,
	type AvatarPlatform
} from './avatar.ts';

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MISS_SECONDS = 60 * 60;
const NOT_FOUND = 404;
const BAD_GATEWAY = 502;

export interface AvatarDeps {
	fetch: (url: string, init: RequestInit) => Promise<Response>;
}

/** The body's bytes, or null once it runs past the cap, the rest cancelled unread. */
export async function readCapped(
	body: ReadableStream<Uint8Array> | null,
	cap: number
): Promise<Uint8Array<ArrayBuffer> | null> {
	if (body === null) return new Uint8Array();
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > cap) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.byteLength;
	}
	return out;
}

function miss(status: number): Response {
	return new Response(null, {
		status: status === NOT_FOUND ? NOT_FOUND : BAD_GATEWAY,
		headers: { 'cache-control': `public, max-age=${String(MISS_SECONDS)}` }
	});
}

/** The avatar for a platform's id: a raster at most AVATAR_MAX_BYTES, sandboxed, or a miss. */
export async function serveAvatar(
	platform: AvatarPlatform,
	id: string,
	deps: AvatarDeps
): Promise<Response> {
	try {
		const upstream = await deps.fetch(upstreamAvatarUrl(platform, id), {
			signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS)
		});
		const type = rasterType(upstream.headers.get('content-type'));
		if (!upstream.ok || type === null || tooLarge(upstream.headers.get('content-length'), 0)) {
			await upstream.body?.cancel();
			return miss(upstream.status);
		}
		const bytes = await readCapped(upstream.body, AVATAR_MAX_BYTES);
		if (bytes === null) return miss(BAD_GATEWAY);
		return new Response(bytes, {
			headers: {
				...AVATAR_HEADERS,
				'content-type': type,
				'cache-control': `public, max-age=${String(WEEK_SECONDS)}, immutable`
			}
		});
	} catch {
		return miss(BAD_GATEWAY);
	}
}
