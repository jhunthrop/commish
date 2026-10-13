/** Headshots are served from our own origin at the size they are drawn (spec §2.5). A face asks
 * /img/headshots/<league>/<id>/<width> for its drawn width at 1x and 2x, and the image route
 * fetches that size from the provider once and caches it at the edge. A provider change is the one
 * line in upstreamHeadshotUrl. */

const ESPN_HEADSHOT =
	/^https:\/\/a\.espncdn\.com\/i\/headshots\/([a-z]+)\/players\/full\/(\d+)\.png$/;
const ESPN_COMBINER = 'https://a.espncdn.com/combiner/i';
const HEADSHOT_ASPECT = 436 / 600;
const DENSITIES = [1, 2] as const;

/** Where the image route lives. */
export const HEADSHOT_ROUTE = '/img/headshots';
export const HEADSHOT_LEAGUES = ['nfl'] as const;
export type HeadshotLeague = (typeof HEADSHOT_LEAGUES)[number];
/** The widths the route serves, so the cache holds a bounded set of sizes. */
export const HEADSHOT_MIN_WIDTH = 16;
export const HEADSHOT_MAX_WIDTH = 480;

/** The face draws its image wider than the circle so the head fills it. Face.svelte uses the same ratio. */
export const FACE_OVERFILL = 1.4;

export interface HeadshotSources {
	src: string;
	srcset?: string;
}

export function isHeadshotLeague(value: string): value is HeadshotLeague {
	return (HEADSHOT_LEAGUES as readonly string[]).includes(value);
}

/** The provider's image at a width. The one line a provider change touches. */
export function upstreamHeadshotUrl(league: HeadshotLeague, id: string, width: number): string {
	const query = new URLSearchParams({
		img: `/i/headshots/${league}/players/full/${id}.png`,
		w: String(width),
		h: String(Math.round(width * HEADSHOT_ASPECT))
	});
	return `${ESPN_COMBINER}?${query.toString()}`;
}

function routeUrl(league: string, id: string, width: number): string {
	return `${HEADSHOT_ROUTE}/${league}/${id}/${String(width)}`;
}

/** Sized sources for a face of this diameter. A URL that is not a provider headshot passes through as is. */
export function headshotSources(url: string, size: number): HeadshotSources {
	const match = ESPN_HEADSHOT.exec(url);
	const league = match?.[1];
	const id = match?.[2];
	if (!league || !id || !isHeadshotLeague(league)) return { src: url };
	const drawn = Math.ceil(size * FACE_OVERFILL);
	return {
		src: routeUrl(league, id, drawn),
		srcset: DENSITIES.map(
			(density) => `${routeUrl(league, id, drawn * density)} ${String(density)}x`
		).join(', ')
	};
}
