import { error } from '@sveltejs/kit';
import { AVATAR_ID, avatarCacheKey, isAvatarPlatform } from '#lib/ui/avatar.ts';
import { serveAvatar } from '#lib/ui/avatar-serve.ts';
import type { RequestHandler } from './$types';

/** A fantasy team's avatar, fetched from the platform once and kept at the edge, so every avatar
 * loads from our origin as every headshot does (the headshot route). The answer is serveAvatar's:
 * rasters only, at most AVATAR_MAX_BYTES read, sandboxed, any failure a miss. Cached by its path. */
export const prerender = false;

const NOT_FOUND = 404;
const WEEK_SECONDS = 7 * 24 * 60 * 60;

export const GET: RequestHandler = async ({ params, platform, request }) => {
	const { platform: host, id } = params;
	if (!isAvatarPlatform(host) || !AVATAR_ID.test(id)) error(NOT_FOUND, 'No such avatar.');

	const cache = (platform?.caches as { default?: Cache } | undefined)?.default;
	const key = new Request(avatarCacheKey(request.url), { method: 'GET' });
	const hit = await cache?.match(key);
	if (hit) return hit;

	const response = await serveAvatar(host, id, {
		fetch: (url, init) =>
			fetch(url, { ...init, cf: { cacheEverything: true, cacheTtl: WEEK_SECONDS } })
	});
	if (response.ok && cache && platform) platform.ctx.waitUntil(cache.put(key, response.clone()));
	return response;
};
