import { error } from '@sveltejs/kit';
import { AVATAR_ID, isAvatarPlatform, upstreamAvatarUrl } from '#lib/ui/avatar.ts';
import type { RequestHandler } from './$types';

/** A fantasy team's avatar, fetched from the platform once and kept at the edge, so every avatar
 * loads from our origin as every headshot does (the headshot route). */
export const prerender = false;

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MISS_SECONDS = 60 * 60;
const NOT_FOUND = 404;
const BAD_GATEWAY = 502;

export const GET: RequestHandler = async ({ params, platform, request }) => {
	const { platform: host, id } = params;
	if (!isAvatarPlatform(host) || !AVATAR_ID.test(id)) error(NOT_FOUND, 'No such avatar.');

	const cache = (platform?.caches as { default?: Cache } | undefined)?.default;
	const key = new Request(request.url, { method: 'GET' });
	const hit = await cache?.match(key);
	if (hit) return hit;

	const upstream = await fetch(upstreamAvatarUrl(host, id), {
		cf: { cacheEverything: true, cacheTtl: WEEK_SECONDS }
	});
	const type = upstream.headers.get('content-type') ?? '';
	if (!upstream.ok || !type.startsWith('image/')) {
		return new Response(null, {
			status: upstream.status === NOT_FOUND ? NOT_FOUND : BAD_GATEWAY,
			headers: { 'cache-control': `public, max-age=${String(MISS_SECONDS)}` }
		});
	}

	const response = new Response(upstream.body, {
		headers: {
			'content-type': type,
			'cache-control': `public, max-age=${String(WEEK_SECONDS)}, immutable`,
			'x-content-type-options': 'nosniff'
		}
	});
	if (cache && platform) platform.ctx.waitUntil(cache.put(key, response.clone()));
	return response;
};
