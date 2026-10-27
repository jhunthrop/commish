import { error } from '@sveltejs/kit';
import { edgeImage } from '#lib/server/image-route.ts';
import { HEADSHOT_MAX_WIDTH, HEADSHOT_MIN_WIDTH, isHeadshotLeague } from '#lib/ui/headshot.ts';
import { upstreamHeadshotUrl } from '#lib/ui/headshot-provider.ts';
import type { RequestHandler } from './$types';

/** The previous web's headshot route: a headshot at a drawn width, fetched from the provider once and
 * kept at the edge (server/image-route.ts). Kept one deploy after our own copies (Lane 241,
 * lib/ui/headshot.ts), so a page the previous web built keeps its faces during the window; no page of
 * this web asks it. Remove it with the next web change after that deploy. */
export const prerender = false;

const PLAYER_ID = /^\d{1,12}$/;
const NOT_FOUND = 404;

function width(value: string): number {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < HEADSHOT_MIN_WIDTH || parsed > HEADSHOT_MAX_WIDTH) {
		error(NOT_FOUND, 'No such headshot size.');
	}
	return parsed;
}

export const GET: RequestHandler = async ({ params, platform, url }) => {
	const { league, id } = params;
	if (!isHeadshotLeague(league) || !PLAYER_ID.test(id)) error(NOT_FOUND, 'No such headshot.');
	return edgeImage(upstreamHeadshotUrl(league, id, width(params.width)), { url, platform });
};
