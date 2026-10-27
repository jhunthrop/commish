/** The provider's image addresses the request-time image routes fetch, in one place (spec §2.5): a
 * club's mark at a width, and a headshot at a width for the previous web's headshot route, kept one
 * deploy after our own copies (headshot.ts). No page builds a provider address. */
import type { HeadshotLeague } from './headshot.ts';

const ESPN_IMAGES = 'https://a.espncdn.com';
const HEADSHOT_ASPECT = 436 / 600;

const headshotPath = (league: HeadshotLeague, id: string): string =>
	`/i/headshots/${league}/players/full/${id}.png`;

/** A club's mark from the provider at a width, square (the club mark route's upstream, Lane 66w). */
export function upstreamClubMarkUrl(league: string, club: string, width: number): string {
	const query = new URLSearchParams({
		img: `/i/teamlogos/${league}/500/${club}.png`,
		w: String(width),
		h: String(width)
	});
	return `${ESPN_IMAGES}/combiner/i?${query.toString()}`;
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
