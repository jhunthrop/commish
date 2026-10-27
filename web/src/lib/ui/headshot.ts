/** Every face is our own copy of the player's headshot (Lane 241): research's headshots job keeps one
 * per player per season in our images bucket, public at IMAGES_ORIGIN, at the widths in
 * HEADSHOT_WIDTHS, cached a year. A face asks for the smallest kept width at or above its drawn
 * width, at 1x and 2x, so it looks as it did when the image route sized the provider's file. The API
 * and the run answer the copy's address (`.../headshots/<season>/<id>/320.webp`); a provider address
 * saved before the copies (a sheet row, an old run) is read as the copy of the same id, and any other
 * image off our origin is no face, so the page never asks a third party's server for one. A copy that
 * is missing answers 404 and the face draws the player's initials, as for any image that fails.
 * Research (research/headshots/config.py) and the API (api/internal/headshots) build the same
 * addresses; each pins one example URL in its tests. */

const OUR_COPY =
	/^https:\/\/images\.trycommish\.app\/headshots\/(\d{4})\/(\d{1,12})\/\d{2,3}\.webp$/;
const PROVIDER_HEADSHOT =
	/^https:\/\/a\.espncdn\.com\/i\/headshots\/(?:nfl|college-football)\/players\/full\/(\d{1,12})\.png$/;
const DENSITIES = [1, 2] as const;

/** The images bucket's public host. */
export const IMAGES_ORIGIN = 'https://images.trycommish.app';
/** The widths a copy is kept at (research/headshots/config.py WIDTHS). */
export const HEADSHOT_WIDTHS = [48, 64, 96, 128, 160, 240, 320, 480] as const;
/** The width the API and the run answer (the apps' largest face). */
export const ANSWERED_WIDTH = 320;
/** The season a saved provider address is read as: the product season (research/season.py), moved
 * with it. */
export const HEADSHOT_SEASON = 2026;

/** The previous web's image route (/img/headshots/<league>/<id>/<width>), answered for one deploy
 * after the copies so a page built before them keeps its faces; no page of this web asks it. */
export const HEADSHOT_ROUTE = '/img/headshots';
export const HEADSHOT_LEAGUES = ['nfl', 'college-football'] as const;
export type HeadshotLeague = (typeof HEADSHOT_LEAGUES)[number];
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

interface Copy {
	season: string;
	id: string;
}

export function isHeadshotLeague(value: string): value is HeadshotLeague {
	return (HEADSHOT_LEAGUES as readonly string[]).includes(value);
}

/** The copy an address names: ours as it is, a provider headshot as the copy of its id. */
function copyOf(url: string): Copy | null {
	const ours = OUR_COPY.exec(url);
	if (ours?.[1] && ours[2]) return { season: ours[1], id: ours[2] };
	const provider = PROVIDER_HEADSHOT.exec(url);
	if (provider?.[1]) return { season: String(HEADSHOT_SEASON), id: provider[1] };
	return null;
}

/** The smallest kept width at or above `drawn`, the largest past them all. */
export function keptWidth(drawn: number): number {
	return HEADSHOT_WIDTHS.find((width) => width >= drawn) ?? HEADSHOT_MAX_WIDTH;
}

function copyUrl(copy: Copy, width: number): string {
	return `${IMAGES_ORIGIN}/headshots/${copy.season}/${copy.id}/${String(width)}.webp`;
}

/** A player's face by his board id (the provider's id, which keys his copy). */
export function headshotFor(boardId: string): string {
	return copyUrl({ season: String(HEADSHOT_SEASON), id: boardId }, ANSWERED_WIDTH);
}

/** Sized sources for a face of this diameter, and of its phone diameter when it has its own: the
 * kept widths for the drawn width at 1x and 2x, as density descriptors, or as width descriptors with
 * the sizes that pick between them, so a phone asks for a face-sized image. An address on our own
 * origin (a club mark) passes as it is; any other is no face (null), and the face draws initials. */
export function headshotSources(
	url: string,
	size: number,
	phoneSize?: number
): HeadshotSources | null {
	const copy = copyOf(url);
	if (copy === null) return url.startsWith('/') && !url.startsWith('//') ? { src: url } : null;
	const drawn = Math.ceil(size * FACE_OVERFILL);
	if (phoneSize === undefined || phoneSize === size) {
		return {
			src: copyUrl(copy, keptWidth(drawn)),
			srcset: DENSITIES.map(
				(density) => `${copyUrl(copy, keptWidth(drawn * density))} ${String(density)}x`
			).join(', ')
		};
	}
	const phoneDrawn = Math.ceil(phoneSize * FACE_OVERFILL);
	const widths = [
		...new Set(DENSITIES.flatMap((d) => [keptWidth(phoneDrawn * d), keptWidth(drawn * d)]))
	].sort((a, b) => a - b);
	return {
		src: copyUrl(copy, keptWidth(drawn)),
		srcset: widths.map((width) => `${copyUrl(copy, width)} ${String(width)}w`).join(', '),
		sizes: `${PHONE_MEDIA} ${String(phoneDrawn)}px, ${String(drawn)}px`
	};
}

/** A face's copy at one width, absolute, for a share card or structured data; null for an address
 * that names no copy, which is never named off the page. */
export function headshotAt(url: string, width: number): string | null {
	const copy = copyOf(url);
	return copy === null ? null : copyUrl(copy, keptWidth(width));
}
