/** The headshot provider's addresses, in one place (spec §2.5): a player's headshot by his board id
 * (the provider's id), and the provider's image at a drawn width, which the image route fetches. A
 * provider change touches this module and headshot.ts's matcher. Kept apart from headshot.ts, which
 * every page loads, so the pages that build no address carry none of it. */
import type { HeadshotLeague } from './headshot.ts';

const ESPN_IMAGES = 'https://a.espncdn.com';
const HEADSHOT_ASPECT = 436 / 600;

const headshotPath = (league: HeadshotLeague, id: string): string =>
	`/i/headshots/${league}/players/full/${id}.png`;

/** A player's headshot by his board id, as a face asks for it (the face routes it to our origin). */
export function headshotUrlFor(boardId: string, league: HeadshotLeague = 'nfl'): string {
	return `${ESPN_IMAGES}${headshotPath(league, boardId)}`;
}

/** The provider's image at a width. */
export function upstreamHeadshotUrl(league: HeadshotLeague, id: string, width: number): string {
	const query = new URLSearchParams({
		img: headshotPath(league, id),
		w: String(width),
		h: String(Math.round(width * HEADSHOT_ASPECT))
	});
	return `${ESPN_IMAGES}/combiner/i?${query.toString()}`;
}
