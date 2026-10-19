/** Headshots are served from our own origin at the size they are drawn (spec §2.5). A face asks
 * /img/headshots/<league>/<id>/<width> for its drawn width at 1x and 2x, and the image route
 * fetches that size from the provider once and caches it at the edge. The provider's addresses are
 * built in headshot-provider.ts; a provider change touches it and the matcher here. */

const ESPN_HEADSHOT =
	/^https:\/\/a\.espncdn\.com\/i\/headshots\/([a-z-]+)\/players\/full\/(\d+)\.png$/;
const DENSITIES = [1, 2] as const;

/** Where the image route lives. */
export const HEADSHOT_ROUTE = '/img/headshots';
/** The provider's leagues a face comes from: the NFL's, and the college headshot a rookie's row can
 * still carry before the provider has his NFL one. */
export const HEADSHOT_LEAGUES = ['nfl', 'college-football'] as const;
export type HeadshotLeague = (typeof HEADSHOT_LEAGUES)[number];
/** The widths the route serves, so the cache holds a bounded set of sizes. */
export const HEADSHOT_MIN_WIDTH = 16;
export const HEADSHOT_MAX_WIDTH = 480;

/** The face draws its image wider than the circle so the head fills it. Face.svelte uses the same ratio. */
export const FACE_OVERFILL = 1.4;

/** The phone's width, the same breakpoint as every component's `@media (max-width: 760px)`. */
export const PHONE_MEDIA = '(max-width: 760px)';

export interface HeadshotSources {
	src: string;
	srcset?: string;
	/** Set when the face is smaller on the phone: the srcset then lists widths, and this says which. */
	sizes?: string;
}

export function isHeadshotLeague(value: string): value is HeadshotLeague {
	return (HEADSHOT_LEAGUES as readonly string[]).includes(value);
}

function routeUrl(league: string, id: string, width: number): string {
	return `${HEADSHOT_ROUTE}/${league}/${id}/${String(width)}`;
}

/** Sized sources for a face of this diameter, and of its phone diameter when it has its own: the
 * drawn widths at 1x and 2x as width descriptors with the sizes that pick between them, so a phone
 * asks for a face-sized image. A URL that is not a provider headshot passes through as is. */
export function headshotSources(url: string, size: number, phoneSize?: number): HeadshotSources {
	const match = ESPN_HEADSHOT.exec(url);
	const league = match?.[1];
	const id = match?.[2];
	if (!league || !id || !isHeadshotLeague(league)) return { src: url };
	const drawn = Math.ceil(size * FACE_OVERFILL);
	if (phoneSize === undefined || phoneSize === size) {
		return {
			src: routeUrl(league, id, drawn),
			srcset: DENSITIES.map(
				(density) => `${routeUrl(league, id, drawn * density)} ${String(density)}x`
			).join(', ')
		};
	}
	const phoneDrawn = Math.ceil(phoneSize * FACE_OVERFILL);
	const widths = [...new Set(DENSITIES.flatMap((d) => [phoneDrawn * d, drawn * d]))].sort(
		(a, b) => a - b
	);
	return {
		src: routeUrl(league, id, drawn),
		srcset: widths.map((width) => `${routeUrl(league, id, width)} ${String(width)}w`).join(', '),
		sizes: `${PHONE_MEDIA} ${String(phoneDrawn)}px, ${String(drawn)}px`
	};
}
