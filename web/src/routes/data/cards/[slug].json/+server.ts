import { buildInstant } from '#lib/server/build-clock.ts';
import { playerEntries, playerPage } from '#lib/server/pages/player.ts';
import { cardData } from '#lib/player/card-source.ts';
import type { EntryGenerator, RequestHandler } from './$types';

/** The top of one player's page as a static file (Lane 113): what the player shelf reads when a
 * league screen's row opens his card, built by the same function and at the same instant as his
 * page, so the shelf shows what the page does and a phone fetches none of the page's game log. */
export const prerender = true;

export const entries: EntryGenerator = playerEntries;

export const GET: RequestHandler = async ({ params }) =>
	Response.json(cardData(await playerPage(params.slug, buildInstant())));
