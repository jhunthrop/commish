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

/** The avatar as our origin serves it, null for an address we do not serve. */
export function avatarSrc(url: string | null): string | null {
	const id = url === null ? undefined : SLEEPER_AVATAR.exec(url)?.[1];
	return id === undefined ? null : `${AVATAR_ROUTE}/sleeper/${id}`;
}
