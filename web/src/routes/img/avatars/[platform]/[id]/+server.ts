import { error } from '@sveltejs/kit';
import {
	AVATAR_HEADERS,
	AVATAR_ID,
	AVATAR_TIMEOUT_MS,
	avatarCacheKey,
	isAvatarPlatform,
	rasterType,
	tooLarge,
	upstreamAvatarUrl
} from '#lib/ui/avatar.ts';
import type { RequestHandler } from './$types';

/** A fantasy team's avatar, fetched from the platform once and kept at the edge, so every avatar
 * loads from our origin as every headshot does (the headshot route). Rasters only, at most
 * AVATAR_MAX_BYTES, served sandboxed; a platform that is slow, sends another type or too much is
 * answered as a miss, and the team's initials stand in. */
export const prerender = false;

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MISS_SECONDS = 60 * 60;
const NOT_FOUND = 404;
const BAD_GATEWAY = 502;

function miss(status: number): Response {
	return new Response(null, {
		status: status === NOT_FOUND ? NOT_FOUND : BAD_GATEWAY,
		headers: { 'cache-control': `public, max-age=${String(MISS_SECONDS)}` }
	});
}

export const GET: RequestHandler = async ({ params, platform, request }) => {
	const { platform: host, id } = params;
	if (!isAvatarPlatform(host) || !AVATAR_ID.test(id)) error(NOT_FOUND, 'No such avatar.');

	const cache = (platform?.caches as { default?: Cache } | undefined)?.default;
	const key = new Request(avatarCacheKey(request.url), { method: 'GET' });
	const hit = await cache?.match(key);
	if (hit) return hit;

	let upstream: Response;
	try {
		upstream = await fetch(upstreamAvatarUrl(host, id), {
			cf: { cacheEverything: true, cacheTtl: WEEK_SECONDS },
			signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS)
		});
	} catch {
		return miss(BAD_GATEWAY);
	}
	const type = rasterType(upstream.headers.get('content-type'));
	if (!upstream.ok || type === null || tooLarge(upstream.headers.get('content-length'), 0)) {
		return miss(upstream.status);
	}
	const body = await upstream.arrayBuffer();
	if (tooLarge(null, body.byteLength)) return miss(BAD_GATEWAY);

	const response = new Response(body, {
		headers: {
			...AVATAR_HEADERS,
			'content-type': type,
			'cache-control': `public, max-age=${String(WEEK_SECONDS)}, immutable`
		}
	});
	if (cache && platform) platform.ctx.waitUntil(cache.put(key, response.clone()));
	return response;
};
