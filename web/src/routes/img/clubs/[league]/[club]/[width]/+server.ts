import { error } from '@sveltejs/kit';
import { clubMarkPath, edgeImage } from '#lib/server/image-route.ts';
import { upstreamClubMarkUrl } from '#lib/ui/headshot-provider.ts';
import type { RequestHandler } from './$types';

/** A club's mark at a drawn width (Lane 66w): one of the 32 clubs at a width a screen draws, fetched
 * from the provider once and kept at the edge (server/image-route.ts), so every defense's face loads
 * from our origin at its size, never the provider's 500 px file. */
export const prerender = false;

const NOT_FOUND = 404;

export const GET: RequestHandler = async ({ platform, url }) => {
	const asked = clubMarkPath(url.pathname);
	if (asked === null) error(NOT_FOUND, 'No such club mark.');
	return edgeImage(upstreamClubMarkUrl(asked.league, asked.club, asked.width), { url, platform });
};
