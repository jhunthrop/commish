/** Headshots are served at the size they are drawn. A full ESPN headshot is 600 by 436 and about
 * 260 KB, where a 40px face needs a tenth of that. ESPN's image combiner resizes the same public
 * image, so a face asks it for exactly its drawn width at 1x and 2x. */

const ESPN_ORIGIN = 'https://a.espncdn.com';
const ESPN_HEADSHOT_PATH = /^\/i\/headshots\/[a-z]+\/players\/full\/[\w-]+\.png$/;
const ESPN_COMBINER = `${ESPN_ORIGIN}/combiner/i`;
const HEADSHOT_ASPECT = 436 / 600;
const DENSITIES = [1, 2] as const;

/** The face draws its image wider than the circle so the head fills it. Face.svelte uses the same ratio. */
export const FACE_OVERFILL = 1.4;

export interface HeadshotSources {
	src: string;
	srcset?: string;
}

function espnPath(url: string): string | null {
	if (!url.startsWith(`${ESPN_ORIGIN}/`)) return null;
	const path = new URL(url).pathname;
	return ESPN_HEADSHOT_PATH.test(path) ? path : null;
}

function combinerUrl(path: string, width: number): string {
	const height = Math.round(width * HEADSHOT_ASPECT);
	const query = new URLSearchParams({ img: path, w: String(width), h: String(height) });
	return `${ESPN_COMBINER}?${query.toString()}`;
}

/** Sized sources for a face of this diameter. A URL that is not an ESPN headshot passes through as is. */
export function headshotSources(url: string, size: number): HeadshotSources {
	const path = espnPath(url);
	if (path === null) return { src: url };
	const drawn = Math.ceil(size * FACE_OVERFILL);
	return {
		src: combinerUrl(path, drawn),
		srcset: DENSITIES.map((density) => `${combinerUrl(path, drawn * density)} ${density}x`).join(
			', '
		)
	};
}
