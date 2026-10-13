import { index, player } from '#lib/server/run.ts';
import type { PlayerData } from '#lib/site/player-data.ts';
import type { EntryGenerator, RequestHandler } from './$types';

/** One player's numbers in every format, without the capsule, as a static file: what the board's
 * sheet rail and the comparison page fetch. */
export const prerender = true;

export const entries: EntryGenerator = async () => (await index()).map(({ id }) => ({ id }));

export const GET: RequestHandler = async ({ params }) => {
	const { id, slug, name, position, team, headshot, formats } = await player(params.id);
	const data: PlayerData = { id, slug, name, position, team, headshot, formats };
	return Response.json(data);
};
