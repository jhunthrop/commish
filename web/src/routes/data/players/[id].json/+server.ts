import { designations, index, manifest, player } from '#lib/server/run.ts';
import type { PlayerData } from '#lib/site/player-data.ts';
import type { EntryGenerator, RequestHandler } from './$types';

/** One player's numbers in every format, without the capsule, as a static file: what the board's
 * sheet rail and the comparison page fetch. */
export const prerender = true;

export const entries: EntryGenerator = async () => (await index()).map(({ id }) => ({ id }));

export const GET: RequestHandler = async ({ params }) => {
	const [
		{ id, slug, name, position, team, headshot, formats, priorSeasons },
		capture,
		entries,
		run
	] = await Promise.all([player(params.id), designations(), index(), manifest()]);
	const status = capture?.players[id];
	const seasonSoFar = entries.find((entry) => entry.id === id)?.season;
	const last = priorSeasons?.find((prior) => prior.season === run.season - 1);
	const data: PlayerData = {
		id,
		slug,
		name,
		position,
		team,
		headshot,
		formats,
		...(status === undefined ? {} : { status }),
		...(seasonSoFar === undefined ? {} : { seasonSoFar }),
		...(last === undefined
			? {}
			: {
					lastSeason: { season: last.season, games: last.games, pointsPerGame: last.pointsPerGame }
				})
	};
	return Response.json(data);
};
