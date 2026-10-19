/** The request-time image routes' one way of answering (Lane 66w review finding 3): a provider image
 * at a drawn width, fetched once and kept at the edge, keyed on the path alone so a query string never
 * makes another copy. The headshot route and the club mark route both answer through it; each keeps
 * only its own rule for which paths it serves. */
import { clubCodes } from '#lib/format/clubs.ts';
import { CLUB_MARK_LEAGUE, CLUB_MARK_ROUTE, CLUB_MARK_WIDTHS } from '#lib/ui/club-mark.ts';

const WEEK_SECONDS = 7 * 24 * 60 * 60;
const MISS_SECONDS = 60 * 60;
const NOT_FOUND = 404;
const BAD_GATEWAY = 502;

/** What an image route reads from its request. */
export interface ImageEvent {
	url: URL;
	platform?: { caches?: unknown; ctx: { waitUntil: (promise: Promise<unknown>) => void } };
}

/** The edge cache's key for a request: its origin and path, never its query. */
export function imageCacheKey(url: URL): string {
	return `${url.origin}${url.pathname}`;
}

/** The provider's image at `upstream`, from the edge cache when it holds it: a hit is kept a week and
 * marked immutable, a miss (or a provider failure) a short hour. */
export async function edgeImage(upstream: string, event: ImageEvent): Promise<Response> {
	const cache = (event.platform?.caches as { default?: Cache } | undefined)?.default;
	const key = new Request(imageCacheKey(event.url), { method: 'GET' });
	const hit = await cache?.match(key);
	if (hit) return hit;

	const answer = await fetch(upstream, { cf: { cacheEverything: true, cacheTtl: WEEK_SECONDS } });
	if (!answer.ok) {
		return new Response(null, {
			status: answer.status === NOT_FOUND ? NOT_FOUND : BAD_GATEWAY,
			headers: { 'cache-control': `public, max-age=${String(MISS_SECONDS)}` }
		});
	}
	const response = new Response(answer.body, {
		headers: {
			'content-type': answer.headers.get('content-type') ?? 'image/png',
			'cache-control': `public, max-age=${String(WEEK_SECONDS)}, immutable`,
			'x-content-type-options': 'nosniff'
		}
	});
	if (cache && event.platform) event.platform.ctx.waitUntil(cache.put(key, response.clone()));
	return response;
}

const CLUB_PATH = new RegExp(`^${CLUB_MARK_ROUTE}/([a-z]+)/([a-z]+)/(\\d+)$`);

/** The club mark route's path read back: one of the 32 clubs at a width a screen draws; null for
 * any other path. */
export function clubMarkPath(path: string): { league: string; club: string; width: number } | null {
	const [, league = '', club = '', widthText = ''] = CLUB_PATH.exec(path) ?? [];
	const width = Number(widthText);
	const known = clubCodes().some((code) => code.toLowerCase() === club);
	if (league !== CLUB_MARK_LEAGUE || !known || !CLUB_MARK_WIDTHS.includes(width)) return null;
	return { league, club, width };
}
