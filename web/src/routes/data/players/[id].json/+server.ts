import { designations, index, player } from '#lib/server/run.ts';
import type { PlayerData } from '#lib/site/player-data.ts';
import type { EntryGenerator, RequestHandler } from './$types';

/** One player's numbers in every format, without the capsule, as a static file: what the board's
 * sheet rail and the comparison page fetch. */
export const prerender = true;

export const entries: EntryGenerator = async () => (await index()).map(({ id }) => ({ id }));

export const GET: RequestHandler = async ({ params }) => {
	const [{ id, slug, name, position, team, headshot, formats }, capture] = await Promise.all([
		player(params.id),
		designations()
	]);
	const status = capture?.players[id];
	const data: PlayerData = {
		id,
		slug,
		name,
		position,
		team,
		headshot,
		formats,
		...(status === undefined ? {} : { status })
	};
	return Response.json(data);
};
