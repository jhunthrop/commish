import { error } from '@sveltejs/kit';
import { clubMarkPath } from '#lib/ui/club-mark.ts';
import { upstreamClubMarkUrl } from '#lib/ui/headshot-provider.ts';
import type { RequestHandler } from './$types';

/** A club's mark at a drawn width (Lane 66w), fetched from the provider once and kept at the edge, so
 * every defense's face loads from our origin at its size, as every headshot does (the headshot route),
 * never the provider's 500 px file. */
export const prerender = false;

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MISS_SECONDS = 60 * 60;
const NOT_FOUND = 404;
const BAD_GATEWAY = 502;

export const GET: RequestHandler = async ({ platform, request, url }) => {
	const asked = clubMarkPath(url.pathname);
	if (asked === null) error(NOT_FOUND, 'No such club mark.');

	const cache = (platform?.caches as { default?: Cache } | undefined)?.default;
	const key = new Request(request.url, { method: 'GET' });
	const hit = await cache?.match(key);
	if (hit) return hit;

	const upstream = await fetch(upstreamClubMarkUrl(asked.league, asked.club, asked.width), {
		cf: { cacheEverything: true, cacheTtl: WEEK_SECONDS }
	});
	if (!upstream.ok) {
		return new Response(null, {
			status: upstream.status === NOT_FOUND ? NOT_FOUND : BAD_GATEWAY,
			headers: { 'cache-control': `public, max-age=${String(MISS_SECONDS)}` }
		});
	}

	const response = new Response(upstream.body, {
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'image/png',
			'cache-control': `public, max-age=${String(WEEK_SECONDS)}, immutable`,
			'x-content-type-options': 'nosniff'
		}
	});
	if (cache && platform) platform.ctx.waitUntil(cache.put(key, response.clone()));
	return response;
};
