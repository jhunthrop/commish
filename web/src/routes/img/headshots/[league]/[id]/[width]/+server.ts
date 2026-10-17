import { error } from '@sveltejs/kit';
import { HEADSHOT_MAX_WIDTH, HEADSHOT_MIN_WIDTH, isHeadshotLeague } from '#lib/ui/headshot.ts';
import { upstreamHeadshotUrl } from '#lib/ui/headshot-provider.ts';
import type { RequestHandler } from './$types';

/** The one request-time route of the nightly site: a headshot at a drawn width, fetched from the
 * provider once and kept at the edge, so every face loads from our origin. */
export const prerender = false;

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MISS_SECONDS = 60 * 60;
const PLAYER_ID = /^\d{1,12}$/;
const NOT_FOUND = 404;
const BAD_GATEWAY = 502;

function width(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < HEADSHOT_MIN_WIDTH || parsed > HEADSHOT_MAX_WIDTH) {
		error(NOT_FOUND, 'No such headshot size.');
	}
	return parsed;
}

export const GET: RequestHandler = async ({ params, platform, request }) => {
	const { league, id } = params;
	if (!isHeadshotLeague(league) || !PLAYER_ID.test(id)) error(NOT_FOUND, 'No such headshot.');
	const drawn = width(params.width);

	const cache = (platform?.caches as { default?: Cache } | undefined)?.default;
	const key = new Request(request.url, { method: 'GET' });
	const hit = await cache?.match(key);
	if (hit) return hit;

	const upstream = await fetch(upstreamHeadshotUrl(league, id, drawn), {
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
