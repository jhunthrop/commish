/** A fantasy team's avatar is served from our own origin, as a headshot is (headshot.ts): the
 * platform's image at /img/avatars/<platform>/<id>, fetched once and kept at the edge. Sleeper alone
 * gives an avatar we show; the one line a provider change touches is upstreamAvatarUrl. */

const SLEEPER_AVATAR = /^https:\/\/sleepercdn\.com\/avatars\/thumbs\/([0-9a-f]{32})$/;

/** Where the image route lives. */
export const AVATAR_ROUTE = '/img/avatars';
export const AVATAR_PLATFORMS = ['sleeper'] as const;
export type AvatarPlatform = (typeof AVATAR_PLATFORMS)[number];
/** A Sleeper avatar id: 32 hex digits. */
export const AVATAR_ID = /^[0-9a-f]{32}$/;

export function isAvatarPlatform(value: string): value is AvatarPlatform {
	return (AVATAR_PLATFORMS as readonly string[]).includes(value);
}

/** The platform's image for an avatar id. */
export function upstreamAvatarUrl(platform: AvatarPlatform, id: string): string {
	const hosts: Readonly<Record<AvatarPlatform, string>> = {
		sleeper: 'https://sleepercdn.com/avatars/thumbs/'
	};
	return `${hosts[platform]}${id}`;
}

/** The image types the route serves: rasters only, never an SVG, which runs script when opened. */
const RASTER_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
/** The largest avatar the route serves; a platform's thumbnail is a few kilobytes. */
export const AVATAR_MAX_BYTES = 256 * 1024;
/** How long the route waits on the platform. */
export const AVATAR_TIMEOUT_MS = 5000;
/** Every avatar is served sandboxed, its type never guessed. */
export const AVATAR_HEADERS = {
	'content-security-policy': "default-src 'none'; sandbox",
	'x-content-type-options': 'nosniff'
} as const;

/** The raster type of a response, null for any other. */
export function rasterType(contentType: string | null): string | null {
	const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
	return RASTER_TYPES.has(type) ? type : null;
}

/** An avatar over the cap, by its stated length or the bytes read. */
export function tooLarge(contentLength: string | null, bytes: number): boolean {
	const stated = contentLength === null ? 0 : Number(contentLength);
	return stated > AVATAR_MAX_BYTES || bytes > AVATAR_MAX_BYTES;
}

/** The cache's key for a request: its path alone, so a query never makes a second entry. */
export function avatarCacheKey(url: string): string {
	const u = new URL(url);
	return `${u.origin}${u.pathname}`;
}

/** The avatar as our origin serves it, null for an address we do not serve. */
export function avatarSrc(url: string | null): string | null {
	const id = url === null ? undefined : SLEEPER_AVATAR.exec(url)?.[1];
	return id === undefined ? null : `${AVATAR_ROUTE}/sleeper/${id}`;
}
